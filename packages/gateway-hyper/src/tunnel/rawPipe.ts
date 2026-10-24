import type net from 'node:net'
import type { Duplex } from 'node:stream'

/** How long a side may stay open after the other closed cleanly before it is destroyed. */
export const RAW_CLOSE_GRACE_MS = 30_000

export type RawPipeResult = {
  /** Bytes read from the TCP socket and sent over the HyperDHT stream */
  tcpBytesRead: number
  /** Bytes from the HyperDHT stream written to the TCP socket */
  tcpBytesWritten: number
  durationMs: number
  /** First error on either side, as `hyper:<code>` or `tcp:<code>`, or null */
  error: string | null
}

export type RawPipe = {
  /** Record an error that is about to destroy one side, e.g. a connect timeout. */
  fail: (label: string) => void
}

function errorLabel(side: 'hyper' | 'tcp', err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  const message = err instanceof Error ? err.message : String(err)
  return `${side}:${typeof code === 'string' ? code : message}`
}

/**
 * Copy bytes both ways between a HyperDHT stream and a TCP socket until both close.
 *
 * HyperDHT → TCP is forwarded by hand with backpressure, not with `stream.pipe(socket)`:
 * streamx's pipe destroys its source with PREMATURE_CLOSE when the destination closes first,
 * so the far end would see a reset even though every byte arrived. TCP → HyperDHT uses Node's
 * `pipe`, which has no such problem. Half-closes pass through, so an HTTP connection ends the
 * way its client or server ended it; `tcp` must be created with `allowHalfOpen: true` for that.
 *
 * When one side closes cleanly, the other is ended so data already written still arrives,
 * and destroyed only if it is still open `graceMs` later. After an error on either side, the
 * other is destroyed at once.
 */
export function pipeRaw(
  hyper: Duplex,
  tcp: net.Socket,
  options: { graceMs?: number; onClose?: (result: RawPipeResult) => void } = {},
): RawPipe {
  const graceMs = options.graceMs ?? RAW_CLOSE_GRACE_MS
  const started = performance.now()
  let error: string | null = null
  let closed = 0

  hyper.on('data', (chunk: Buffer) => {
    if (!tcp.write(chunk)) hyper.pause()
  })
  tcp.on('drain', () => hyper.resume())
  hyper.on('end', () => tcp.end())
  tcp.pipe(hyper)

  hyper.on('error', (err: unknown) => {
    error ??= errorLabel('hyper', err)
  })
  tcp.on('error', (err: unknown) => {
    error ??= errorLabel('tcp', err)
  })

  const closeOther = (other: Duplex) => () => {
    if (other.destroyed) return
    if (error) {
      other.destroy()
      return
    }
    other.end()
    setTimeout(() => other.destroy(), graceMs).unref()
  }
  const onClose = () => {
    if (++closed < 2) return
    options.onClose?.({
      tcpBytesRead: tcp.bytesRead,
      tcpBytesWritten: tcp.bytesWritten,
      durationMs: Math.round(performance.now() - started),
      error,
    })
  }
  hyper.on('close', closeOther(tcp))
  tcp.on('close', closeOther(hyper))
  hyper.on('close', onClose)
  tcp.on('close', onClose)

  return {
    fail: (label) => {
      error ??= label
    },
  }
}
