export type TunnelMeta = {
  method: string
  path: string
  headers: Record<string, string>
}

export type TunnelResponseMeta = {
  status: number
  headers: Record<string, string>
}

export type ServeTunnelOptions = {
  /** Upstream HTTP origin (e.g. http://127.0.0.1:80) */
  upstream: string
  /** Operator Ed25519 keypair file (JSON) — created on first run if missing */
  keyFile?: string
  /** Directory for DHT state (optional, in-memory if unset) */
  storePath?: string
}

export type ServeTunnelResult = {
  /** Operator public key (z32) */
  key: string
  upstream: string
  close: () => Promise<void>
}

export type ConnectTunnelOptions = {
  /** Operator public key (z32 or hex) */
  key: string
  /** Local HTTP bind host */
  host?: string
  /** Local HTTP bind port */
  port?: number
  /** Optional store path for DHT client state */
  storePath?: string
}

export type ConnectTunnelResult = {
  key: string
  host: string
  port: number
  baseUrl: string
  close: () => Promise<void>
}

export type OperatorKeyPair = {
  publicKey: Buffer
  secretKey: Buffer
  z32: string
}
