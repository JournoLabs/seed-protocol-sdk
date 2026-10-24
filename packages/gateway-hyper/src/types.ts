export type TunnelMeta = {
  method: string
  path: string
  headers: Record<string, string>
}

export type TunnelResponseMeta = {
  status: number
  headers: Record<string, string>
}

/** A HyperDHT bootstrap node. */
export type DhtBootstrapNode = { host: string; port: number }

export type ServeTunnelOptions = {
  /** Upstream HTTP origin (e.g. http://127.0.0.1:80) */
  upstream: string
  /** Operator Ed25519 keypair file (JSON) — created on first run if missing */
  keyFile?: string
  /** Directory for DHT state (optional, in-memory if unset) */
  storePath?: string
  /**
   * HyperDHT bootstrap nodes. Defaults to the public network; set it to join a private or
   * local one (e.g. `hyperdht/testnet` in tests).
   */
  bootstrap?: DhtBootstrapNode[]
  /**
   * Answer 504 once the upstream socket has been idle this long, waiting for headers or
   * body. Default 30 000; 0 disables.
   */
  upstreamTimeoutMs?: number
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
  /**
   * Keypair file (JSON, created on first run if missing) for the key this client presents to
   * the operator. A fixed key can go on the operator's key allowlist. Without `keyFile` or
   * `keyPair`, each run uses a new key.
   */
  keyFile?: string
  /** The client keypair itself, e.g. decoded from an env var. Exclusive with `keyFile`. */
  keyPair?: { publicKey: Buffer; secretKey: Buffer }
  /** Local HTTP bind host */
  host?: string
  /** Local HTTP bind port */
  port?: number
  /** Optional store path for DHT client state */
  storePath?: string
  /**
   * HyperDHT bootstrap nodes. Defaults to the public network; set it to join a private or
   * local one (e.g. `hyperdht/testnet` in tests).
   */
  bootstrap?: DhtBootstrapNode[]
  /**
   * Abandon a request once the tunnel stream has sent and received nothing for this long,
   * answer 504, and reconnect for the next request. Keep it above the operator's
   * `upstreamTimeoutMs` so the operator's own 504 arrives first. Default 60 000; 0 disables.
   */
  requestTimeoutMs?: number
  /** Give up opening the HyperDHT connection after this long. Default 30 000; 0 disables. */
  connectTimeoutMs?: number
  /**
   * Most HyperDHT streams open to the operator at once. Each carries one request at a time,
   * so a slow request holds up only its own stream. Default 4.
   */
  maxStreams?: number
}

export type ConnectTunnelResult = {
  key: string
  /** The public key (z32) this client presents to the operator */
  clientKey: string
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
   * Keypair file (JSON, created on first run if missing) for the key this client presents to
   * the operator. A fixed key can go on the operator's key allowlist. Without `keyFile` or
   * `keyPair`, each run uses a new key.
   */
  keyFile?: string
  /** The client keypair itself, e.g. decoded from an env var. Exclusive with `keyFile`. */
  keyPair?: { publicKey: Buffer; secretKey: Buffer }
  /**
   * URL path prefix the app mounts the proxy on (stripped before tunneling).
   * Default `/api/seed-gateway`.
   */
  mountPath?: string
  /** Optional DHT client state directory */
  storePath?: string
  /**
   * HyperDHT bootstrap nodes. Defaults to the public network; set it to join a private or
   * local one (e.g. `hyperdht/testnet` in tests).
   */
  bootstrap?: DhtBootstrapNode[]
  /** Start the Hyper session immediately (default: lazy on first request) */
  eager?: boolean
  /**
   * Abandon a request once the tunnel stream has sent and received nothing for this long,
   * answer 504, and reconnect for the next request. Keep it above the operator's
   * `upstreamTimeoutMs` so the operator's own 504 arrives first. Default 60 000; 0 disables.
   */
  requestTimeoutMs?: number
  /** Give up opening the HyperDHT connection after this long. Default 30 000; 0 disables. */
  connectTimeoutMs?: number
  /**
   * Most HyperDHT streams open to the operator at once. Each carries one request at a time,
   * so a slow request holds up only its own stream. Default 4.
   */
  maxStreams?: number
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

