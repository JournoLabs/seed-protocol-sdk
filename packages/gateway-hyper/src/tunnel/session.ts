import type { Duplex } from 'node:stream'
import HyperDHT from 'hyperdht'
import { createEphemeralClientKeypair, decodePublicKey } from '../keys'
import type { TunnelMeta, TunnelResponseMeta } from '../types'
import { TunnelConnectTimeoutError, TunnelTimeoutError } from './errors'
import { readTunnelResponse, writeTunnelRequest } from './protocol'

/** Default idle limit for one request on the tunnel stream. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/** Default limit for opening the HyperDHT connection. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

export type TunnelSessionOptions = {
  /** Operator public key (z32 or hex) */
  key: string
  /** Optional store path for DHT client state */
  storePath?: string
  /**
   * Abandon a request once the stream has sent and received nothing for this long, then
   * reconnect for the next request. Counts from when the request reaches the front of the
   * queue. Default 60 000; 0 disables.
   */
  requestTimeoutMs?: number
  /** Give up opening the HyperDHT connection after this long. Default 30 000; 0 disables. */
  connectTimeoutMs?: number
}

export type TunnelRequestOptions = {
  /** Aborting rejects the request; if it is already on the stream, the stream is destroyed. */
  signal?: AbortSignal
  /** Overrides the session's `requestTimeoutMs` for this request. */
  timeoutMs?: number
}

export type TunnelSession = {
  key: string
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

/**
 * Dial the operator HyperDHT key and expose a serialized request/response forwarder.
 *
 * Requests share one stream, one at a time. The framing has no request ids, so a request
 * that is abandoned mid-flight (timeout, abort, or error) destroys the stream; the next
 * request opens a new one.
 */
export async function createTunnelSession(options: TunnelSessionOptions): Promise<TunnelSession> {
  const remotePublicKey = decodePublicKey(options.key)
  const clientKey = createEphemeralClientKeypair()
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS

  const dht = new HyperDHT()
  let activeSocket: Duplex | null = null
  let connecting: Promise<Duplex> | null = null

  const getSocket = async (): Promise<Duplex> => {
    if (activeSocket && !activeSocket.destroyed) {
      return activeSocket
    }
    if (connecting) {
      return connecting
    }
    connecting = new Promise<Duplex>((resolve, reject) => {
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
        connecting = null
        socket.destroy()
        reject(err)
      }
      const onReady = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        activeSocket = socket
        connecting = null
        resolve(socket)
      }
      // Keep a listener for the socket's whole life so a late error never goes unhandled;
      // the frame reader sees errors through its own listener.
      socket.on('error', (err: Error) => fail(err))
      socket.once('close', () => {
        if (activeSocket === socket) activeSocket = null
        fail(new Error('Tunnel connection closed before it opened'))
      })
      socket.once('open', onReady)
      socket.once('connect', onReady)
    })
    return connecting
  }

  const runOnTunnel = createTunnelQueue(getSocket, requestTimeoutMs)

  const forwardHttp = async (
    meta: TunnelMeta,
    body: Buffer,
    opts?: TunnelRequestOptions,
  ): Promise<{ meta: TunnelResponseMeta; body: Buffer }> => {
    return runOnTunnel(async (socket) => {
      await writeTunnelRequest(socket, meta, body)
      return readTunnelResponse(socket)
    }, opts)
  }

  return {
    key: options.key,
    runOnTunnel,
    forwardHttp,
    close: async () => {
      if (activeSocket && !activeSocket.destroyed) {
        activeSocket.destroy()
      }
      await dht.destroy()
    },
  }
}
