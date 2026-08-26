/** How Arweave / upload infrastructure is reached. */
export type SeedGatewayTransportMode = 'http-gateway' | 'hyper' | 'hybrid'

/** Which path {@link ResolvedSeedGatewayEndpoints} selected. */
export type SeedGatewayActivePath = 'http' | 'hyper-sidecar' | 'hybrid-fallback-http'

export interface SeedGatewayHyperConfig {
  /** Operator infrastructure identity (z32). Empty = unset. */
  gatewayHyperKey?: string
  /** Local sidecar bind host (client). Default 127.0.0.1 */
  localSidecarHost?: string
  /** Local sidecar bind port (client). Default 1984 */
  localSidecarPort?: number
  /** Probe sidecar before use in hybrid mode. Default true */
  probeSidecar?: boolean
}

export interface SeedGatewayConfig {
  /** Default `http-gateway` */
  transport?: SeedGatewayTransportMode
  /** HTTP gateway host (no scheme) — existing seed.config field also accepted at top level */
  arweaveDomain?: string
  /** Upload API origin for publish apps (HTTP mode / hybrid fallback) */
  uploadApiBaseUrl?: string
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
  /** Effective host for BaseArweaveClient (hostname:port, no scheme) */
  arweaveHost: string
  arweaveProtocol: 'http' | 'https'
  arweaveBaseUrl: string
  arweaveGraphqlUrl: string
  uploadApiBaseUrl: string
  activePath: SeedGatewayActivePath
  /** Operator Hyper key when configured */
  gatewayHyperKey?: string
}
