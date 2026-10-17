/** Client side: the tunnel stream was idle longer than `requestTimeoutMs`, so the request was abandoned. */
export class TunnelTimeoutError extends Error {
  readonly code = 'TUNNEL_TIMEOUT'

  constructor(readonly timeoutMs: number) {
    super(`No bytes sent or received on the tunnel for ${timeoutMs} ms`)
    this.name = 'TunnelTimeoutError'
  }
}

/** Client side: the HyperDHT connection to the operator did not open within `connectTimeoutMs`. */
export class TunnelConnectTimeoutError extends Error {
  readonly code = 'TUNNEL_CONNECT_TIMEOUT'

  constructor(readonly timeoutMs: number) {
    super(`Could not connect to the operator within ${timeoutMs} ms`)
    this.name = 'TunnelConnectTimeoutError'
  }
}

/** Operator side: the upstream socket was idle longer than `upstreamTimeoutMs`. */
export class UpstreamTimeoutError extends Error {
  readonly code = 'UPSTREAM_TIMEOUT'

  constructor(readonly timeoutMs: number) {
    super(`No response from upstream for ${timeoutMs} ms`)
    this.name = 'UpstreamTimeoutError'
  }
}
