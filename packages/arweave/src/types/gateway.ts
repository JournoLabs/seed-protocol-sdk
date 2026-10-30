/** How Arweave / upload infrastructure is reached. */
export type SeedGatewayTransportMode = 'http-gateway' | 'hyper' | 'hybrid'

/** Which path {@link ResolvedSeedGatewayEndpoints} selected. */
export type SeedGatewayActivePath =
  | 'http'
  | 'http-proxy'
  | 'hyper-sidecar'
  | 'hybrid-fallback-http'

export interface SeedGatewayHyperConfig {
  /** Operator infrastructure identity (z32). Empty = unset. */
  gatewayHyperKey?: string
  /** Local sidecar bind host (client). Default 127.0.0.1 */
  localSidecarHost?: string
  /** Local sidecar bind port (client). Default 1984 */
  localSidecarPort?: number
  /** Probe sidecar / proxy before use. Default true */
  probeSidecar?: boolean
  /** Probe `proxyBaseUrl`'s `/info` before adopting it. Default: `probeSidecar`, else true. */
  probeProxy?: boolean
  /**
   * In a browser, `hybrid` mode tries the local sidecar only when the page's origin is loopback
   * (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`), since a public page's request to it is a
   * public-to-loopback request most visitors would see fail. Set true where the page is meant to
   * reach the sidecar (Electron, desktop shells). Default false.
   */
  probeSidecarFromBrowser?: boolean
}

export interface SeedGatewayConfig {
  /** Default `http-gateway` */
  transport?: SeedGatewayTransportMode
  /** HTTP gateway host (no scheme) — existing seed.config field also accepted at top level */
  arweaveDomain?: string
  /** Upload API origin for publish apps (HTTP mode / hybrid fallback) */
  uploadApiBaseUrl?: string
  /**
   * App-server proxy base URL for browser / web apps (Path B).
   * Absolute (`https://app.example.com/api/seed-gateway`) or same-origin relative (`/api/seed-gateway`).
   * Relative URLs resolve against `window.location.origin` or {@link ResolveSeedGatewayEndpointsOptions.origin}.
   */
  proxyBaseUrl?: string
  /**
   * Read gateways tried before the resolved / public hosts for `/raw/{id}` reads — typically the
   * gateway the app uploads through, which serves an item before the public gateways do. Base URLs
   * with scheme and any path prefix; relative paths resolve like {@link proxyBaseUrl}. Applied at
   * client init via `setPreferredArweaveReadBaseUrls`; does not change upload or GraphQL routing.
   */
  preferredReadBaseUrls?: string[]
  hyper?: SeedGatewayHyperConfig
  /** Shorthand for `hyper.gatewayHyperKey` in seed.config */
  gatewayHyperKey?: string
  /** Shorthand for `hyper.localSidecarHost` */
  localSidecarHost?: string
  /** Shorthand for `hyper.localSidecarPort` */
  localSidecarPort?: number
  /** Shorthand for `hyper.probeSidecar` */
  probeSidecar?: boolean
}

export interface ResolvedSeedGatewayEndpoints {
  mode: SeedGatewayTransportMode
  /**
   * Effective host for BaseArweaveClient (hostname:port, optionally with path prefix, no scheme).
   * Path prefixes are used for app-server proxies (e.g. `app.example.com/api/seed-gateway`).
   */
  arweaveHost: string
  arweaveProtocol: 'http' | 'https'
  arweaveBaseUrl: string
  arweaveGraphqlUrl: string
  uploadApiBaseUrl: string
  activePath: SeedGatewayActivePath
  /** Operator Hyper key when configured */
  gatewayHyperKey?: string
  /** Resolved absolute proxy base when activePath is http-proxy */
  proxyBaseUrl?: string
  /**
   * Public HTTP gateway (`scheme://host`) for URLs written into published content, from
   * `arweaveDomain` (default `arweave.net`). Differs from {@link arweaveBaseUrl} on the
   * sidecar and proxy paths, whose hosts only resolve on this machine or for this app.
   */
  publicArweaveBaseUrl: string
}
