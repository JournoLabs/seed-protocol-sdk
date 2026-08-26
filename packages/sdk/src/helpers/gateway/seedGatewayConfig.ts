import type { ClientManagerContext, SeedConfig, SeedGatewayConfig } from '@/types'
import { DEFAULT_SEED_GATEWAY_HYPER_KEY } from '@/helpers/constants'

/** Merge seed.config gateway fields into {@link SeedGatewayConfig}. */
export function seedGatewayConfigFromSeedConfig(config: SeedConfig): SeedGatewayConfig {
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
  context: Pick<
    ClientManagerContext,
    | 'arweaveDomain'
    | 'uploadApiBaseUrl'
    | 'gatewayTransport'
    | 'gatewayHyperKey'
    | 'gatewaySidecarHost'
    | 'gatewaySidecarPort'
  >,
): SeedGatewayConfig {
  return {
    transport: context.gatewayTransport,
    arweaveDomain: context.arweaveDomain,
    uploadApiBaseUrl: context.uploadApiBaseUrl,
    hyper: {
      gatewayHyperKey: context.gatewayHyperKey?.trim() || DEFAULT_SEED_GATEWAY_HYPER_KEY || undefined,
      localSidecarHost: context.gatewaySidecarHost,
      localSidecarPort: context.gatewaySidecarPort,
    },
  }
}
