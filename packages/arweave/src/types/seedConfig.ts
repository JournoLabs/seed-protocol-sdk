import type { SeedGatewayHyperConfig, SeedGatewayTransportMode, SeedGatewayConfig } from './gateway.js'

/** Minimal seed.config shape for gateway resolution (SDK types are a superset). */
export type SeedConfigGatewayInput = {
  arweaveDomain?: string
  uploadApiBaseUrl?: string
  gateway?: {
    transport?: SeedGatewayTransportMode
    arweaveDomain?: string
    uploadApiBaseUrl?: string
    gatewayHyperKey?: string
    localSidecarHost?: string
    localSidecarPort?: number
    probeSidecar?: boolean
    hyper?: SeedGatewayHyperConfig
  }
}

export type ClientGatewayContextInput = {
  arweaveDomain?: string
  uploadApiBaseUrl?: string
  gatewayTransport?: SeedGatewayTransportMode
  gatewayHyperKey?: string
  gatewaySidecarHost?: string
  gatewaySidecarPort?: number
}

export type { SeedGatewayConfig }
