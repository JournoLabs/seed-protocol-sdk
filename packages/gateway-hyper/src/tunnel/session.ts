import type { Duplex } from 'node:stream'
import HyperDHT from 'hyperdht'
import { decodePublicKey, resolveClientKeypair } from '../keys'
import type { DhtBootstrapNode, TunnelMeta, TunnelResponseMeta } from '../types'
import { TunnelConnectTimeoutError, TunnelTimeoutError } from './errors'
import { readTunnelResponse, writeTunnelRequest } from './protocol'

/** Default idle limit for one request on the tunnel stream. */
/** Above the operator's default upstream timeout (130 s), so the operator's own 504 arrives first. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 150_000

/** Default limit for opening the HyperDHT connection. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

/**
 * Default number of streams a session opens to the operator. Streams open only when every
 * open one is busy, and each costs a DHT lookup and handshake plus an upstream request on
 * the operator, so a small pool keeps that cost down. Four leaves room for a page's burst of
 * gateway reads after one or two requests hang until their timeout.
 */
export const DEFAULT_MAX_STREAMS = 4

export type TunnelSessionOptions = {
  /** Operator public key (z32 or hex) */
  key: string
  /**
   * Keypair file (created on first run if missing) for the key this client presents to the
   * operator. Without `keyFile` or `keyPair`, each session uses a new key.
   */
  keyFile?: string
  /** The client keypair itself. Exclusive with `keyFile`. */
  keyPair?: { publicKey: Buffer; secretKey: Buffer }
  /** HyperDHT bootstrap nodes. Defaults to the public network. */
  bootstrap?: DhtBootstrapNode[]
  /**
   * Abandon a request once the stream has sent and received nothing for this long, then
   * reconnect for the next request. Counts from when the request gets a stream.
   * Default 150 000; 0 disables.
   */
  requestTimeoutMs?: number
  /** Give up opening the HyperDHT connection after this long. Default 30 000; 0 disables. */
  connectTimeoutMs?: number
  /**
   * Most HyperDHT streams open to the operator at once; each carries one request at a time.
   * Default 4.
   */
  maxStreams?: number
}

export type TunnelRequestOptions = {
  /** Aborting rejects the request; if it is already on the stream, the stream is destroyed. */
  signal?: AbortSignal
  /** Overrides the session's `requestTimeoutMs` for this request. */
  timeoutMs?: number
}

export type TunnelSession = {
  key: string
  /** The public key (z32) this client presents to the operator */
  clientKey: string
  runOnTunnel: <T>(
    fn: (socket: Duplex) => Promise<T>,
    options?: TunnelRequestOptions,
  ) => Promise<T>
  forwardHttp: (
    meta: TunnelMeta,
    body: Buffer,
    options?: TunnelRequestOptions,
  ) => Promise<{ meta: TunnelResponseMeta; body: Buffer }>
  close: () => Promise<void>
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  const err = new Error('The request was aborted')
  err.name = 'AbortError'
  return err
}

/** Reject as soon as `signal` aborts, even while `promise` is still queued. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

/**
 * Serialize transactions on the socket `getSocket` returns. Each runs under an idle timeout
 * and an optional abort signal; one that is abandoned or fails destroys the socket, so
 * `getSocket` must open a new one once the current one is destroyed.
 */
export function createTunnelQueue(
  getSocket: () => Promise<Duplex>,
  requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): TunnelSession['runOnTunnel'] {
  const runGuarded = async <T>(
    fn: (socket: Duplex) => Promise<T>,
    opts: TunnelRequestOptions,
  ): Promise<T> => {
    const { signal } = opts
    const timeoutMs = opts.timeoutMs ?? requestTimeoutMs
    if (signal?.aborted) throw abortError(signal)
    const socket = await getSocket()
    if (signal?.aborted) throw abortError(signal)

    return new Promise<T>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const armTimer = () => {
        if (timeoutMs <= 0) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => abandon(new TunnelTimeoutError(timeoutMs)), timeoutMs)
      }
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        socket.off('data', armTimer)
        socket.off('drain', armTimer)
        signal?.removeEventListener('abort', onAbort)
      }
      // A late response would be read as the next request's reply, so the stream goes too.
      const abandon = (err: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        socket.destroy()
        reject(err)
      }
      const onAbort = () => abandon(abortError(signal as AbortSignal))

      armTimer()
      // Bytes moving either way keep the request alive, so large bodies are not cut off.
      socket.on('data', armTimer)
      socket.on('drain', armTimer)
      signal?.addEventListener('abort', onAbort, { once: true })

      fn(socket).then((value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }, abandon)
    })
  }

  let tunnelQueue: Promise<unknown> = Promise.resolve()
  return <T>(
    fn: (socket: Duplex) => Promise<T>,
    opts: TunnelRequestOptions = {},
  ): Promise<T> => {
    const run = tunnelQueue.then(() => runGuarded(fn, opts))
    tunnelQueue = run.catch(() => {})
    return opts.signal ? raceAbort(run, opts.signal) : run
  }
}

type PoolSlot = {
  run: TunnelSession['runOnTunnel']
  socket: Duplex | null
  busy: boolean
}

type PoolWaiter = {
  resolve: (slot: PoolSlot) => void
  reject: (err: Error) => void
}

export type TunnelPoolOptions = {
  /** Most streams open at once. Default `DEFAULT_MAX_STREAMS`. */
  maxStreams?: number
  /** Idle limit for each request, as in `createTunnelQueue`. */
  requestTimeoutMs?: number
}

export type TunnelPool = {
  runOnTunnel: TunnelSession['runOnTunnel']
  /** Reject queued requests and destroy every stream. */
  close: () => void
}

function closedError(): Error {
  return new Error('Tunnel session is closed')
}

/**
 * Run each transaction alone on one of up to `maxStreams` sockets from `openStream`. A request
 * takes an idle open stream if there is one, else opens a new stream while fewer than
 * `maxStreams` exist, else waits for the first stream to come free. Each stream is a
 * `createTunnelQueue`, so a request that is abandoned destroys only its own stream, and that
 * stream reopens for the next request it takes.
 */
export function createTunnelPool(
  openStream: () => Promise<Duplex>,
  options: TunnelPoolOptions = {},
): TunnelPool {
  const maxStreams = Math.max(1, Math.floor(options.maxStreams ?? DEFAULT_MAX_STREAMS))
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const slots: PoolSlot[] = []
  const waiting: PoolWaiter[] = []
  let closed = false

  // A stream the operator ended (after a 403, say) can't carry another response.
  const isLive = (socket: Duplex | null): socket is Duplex =>
    socket !== null && !socket.destroyed && !socket.readableEnded

  const addSlot = (): PoolSlot => {
    const slot: PoolSlot = { run: null as never, socket: null, busy: false }
    // The slot runs one request at a time, so there is never a second open in progress.
    slot.run = createTunnelQueue(async () => {
      if (closed) throw closedError()
      if (isLive(slot.socket)) return slot.socket
      const socket = await openStream()
      if (closed) {
        socket.destroy()
        throw closedError()
      }
      slot.socket = socket
      return socket
    }, requestTimeoutMs)
    slots.push(slot)
    return slot
  }

  const takeSlot = (): PoolSlot | null => {
    const idle = slots.filter((slot) => !slot.busy)
    // An idle slot whose stream died reopens it, same as a new slot would.
    const slot =
      idle.find((s) => isLive(s.socket)) ??
      idle[0] ??
      (slots.length < maxStreams ? addSlot() : undefined)
    if (!slot) return null
    slot.busy = true
    return slot
  }

  const release = (slot: PoolSlot) => {
    const next = waiting.shift()
    if (next) next.resolve(slot)
    else slot.busy = false
  }

  const acquire = (signal: AbortSignal | undefined): Promise<PoolSlot> => {
    const slot = takeSlot()
    if (slot) return Promise.resolve(slot)
    return new Promise<PoolSlot>((resolve, reject) => {
      const onAbort = () => {
        const index = waiting.indexOf(waiter)
        if (index >= 0) waiting.splice(index, 1)
        reject(abortError(signal as AbortSignal))
      }
      const waiter: PoolWaiter = {
        resolve: (s) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(s)
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort)
          reject(err)
        },
      }
      waiting.push(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  const runOnTunnel = async <T>(
    fn: (socket: Duplex) => Promise<T>,
    opts: TunnelRequestOptions = {},
  ): Promise<T> => {
    if (opts.signal?.aborted) throw abortError(opts.signal)
    if (closed) throw closedError()
    const slot = await acquire(opts.signal)
    try {
      return await slot.run(fn, opts)
    } finally {
      release(slot)
    }
  }

  return {
    runOnTunnel,
    close: () => {
      closed = true
      for (const waiter of waiting.splice(0)) waiter.reject(closedError())
      for (const slot of slots) slot.socket?.destroy()
    },
  }
}

/** Whether the operator sent `connection: close`. Upstream `connection` headers never reach the client. */
function closesStream(meta: TunnelResponseMeta): boolean {
  return Object.entries(meta.headers).some(
    ([key, value]) => key.toLowerCase() === 'connection' && /(^|,)\s*close\s*(,|$)/i.test(String(value)),
  )
}

/**
 * Dial the operator HyperDHT key and expose a request/response forwarder.
 *
 * Requests run on a pool of up to `maxStreams` streams to the operator, one request per
 * stream at a time (see `createTunnelPool`). The framing has no request ids, so a request
 * that is abandoned mid-flight (timeout, abort, or error) destroys its stream; the next
 * request on that stream opens a new one.
 */
export async function createTunnelSession(options: TunnelSessionOptions): Promise<TunnelSession> {
  const remotePublicKey = decodePublicKey(options.key)
  const clientKey = resolveClientKeypair(options)
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS

  const dht = new HyperDHT(options.bootstrap ? { bootstrap: options.bootstrap } : {})

  // Without a `pool` option, each connect is its own handshake and encrypted stream.
  const openStream = () =>
    new Promise<Duplex>((resolve, reject) => {
      const socket = dht.connect(remotePublicKey, {
        keyPair: { publicKey: clientKey.publicKey, secretKey: clientKey.secretKey },
      }) as Duplex
      let settled = false
      const timer =
        connectTimeoutMs > 0
          ? setTimeout(() => fail(new TunnelConnectTimeoutError(connectTimeoutMs)), connectTimeoutMs)
          : null
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        socket.destroy()
        reject(err)
      }
      const onReady = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(socket)
      }
      // Keep a listener for the socket's whole life so a late error never goes unhandled;
      // the frame reader sees errors through its own listener.
      socket.on('error', (err: Error) => fail(err))
      socket.once('close', () => fail(new Error('Tunnel connection closed before it opened')))
      // The operator ends a stream after answering a request it refused; the pool opens a new
      // one for the next request.
      socket.once('end', () => socket.destroy())
      socket.once('open', onReady)
      socket.once('connect', onReady)
    })

  const pool = createTunnelPool(openStream, {
    maxStreams: options.maxStreams,
    requestTimeoutMs: options.requestTimeoutMs,
  })
  const { runOnTunnel } = pool

  const forwardHttp = async (
    meta: TunnelMeta,
    body: Buffer,
    opts?: TunnelRequestOptions,
  ): Promise<{ meta: TunnelResponseMeta; body: Buffer }> => {
    return runOnTunnel(async (socket) => {
      await writeTunnelRequest(socket, meta, body)
      const response = await readTunnelResponse(socket)
      // The operator is ending this stream, so the next request opens a new one.
      if (closesStream(response.meta)) socket.destroy()
      return response
    }, opts)
  }

  return {
    key: options.key,
    clientKey: clientKey.z32,
    runOnTunnel,
    forwardHttp,
    close: async () => {
      pool.close()
      await dht.destroy()
    },
  }
}
