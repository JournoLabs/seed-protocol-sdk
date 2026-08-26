import type {
  ClientGatewayContextInput,
  SeedConfigGatewayInput,
  SeedGatewayConfig,
} from '../types/seedConfig.js'
import { DEFAULT_SEED_GATEWAY_HYPER_KEY } from '../constants.js'

/** Merge seed.config gateway fields into {@link SeedGatewayConfig}. */
export function seedGatewayConfigFromSeedConfig(
  config: SeedConfigGatewayInput,
): SeedGatewayConfig {
  const gateway = config.gateway ?? {}
  return {
    transport: gateway.transport,
    arweaveDomain: config.arweaveDomain ?? gateway.arweaveDomain,
    uploadApiBaseUrl: config.uploadApiBaseUrl ?? gateway.uploadApiBaseUrl,
    hyper: {
      gatewayHyperKey:
        gateway.hyper?.gatewayHyperKey?.trim() ||
        gateway.gatewayHyperKey?.trim() ||
        DEFAULT_SEED_GATEWAY_HYPER_KEY ||
        undefined,
      localSidecarHost: gateway.hyper?.localSidecarHost ?? gateway.localSidecarHost,
      localSidecarPort: gateway.hyper?.localSidecarPort ?? gateway.localSidecarPort,
      probeSidecar: gateway.hyper?.probeSidecar ?? gateway.probeSidecar,
    },
  }
}

export function seedGatewayConfigFromClientContext(
  context: ClientGatewayContextInput,
): SeedGatewayConfig {
  return {
    transport: context.gatewayTransport,
    arweaveDomain: context.arweaveDomain,
    uploadApiBaseUrl: context.uploadApiBaseUrl,
    hyper: {
      gatewayHyperKey:
        context.gatewayHyperKey?.trim() || DEFAULT_SEED_GATEWAY_HYPER_KEY || undefined,
      localSidecarHost: context.gatewaySidecarHost,
      localSidecarPort: context.gatewaySidecarPort,
    },
  }
}
