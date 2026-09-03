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

export type CreateGatewayProxyOptions = {
  /**
   * Operator public key (z32 or hex).
   * Defaults to `process.env.SEED_GATEWAY_HYPER_KEY`.
   */
  key?: string
  /**
   * URL path prefix the app mounts the proxy on (stripped before tunneling).
   * Default `/api/seed-gateway`.
   */
  mountPath?: string
  /** Optional DHT client state directory */
  storePath?: string
  /** Start the Hyper session immediately (default: lazy on first request) */
  eager?: boolean
}

export type GatewayProxy = {
  mountPath: string
  /** Ensure the Hyper tunnel session is connected */
  start: () => Promise<void>
  close: () => Promise<void>
  /** Express / `node:http` style handler */
  handleNode: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
  /**
   * Fetch API handler for Next.js App Router (Node runtime only — not Edge).
   * Export as GET/POST/PUT/PATCH/DELETE.
   */
  handleFetch: (request: Request) => Promise<Response>
}

