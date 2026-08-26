import type { ResolvedSeedGatewayEndpoints } from '@/types/gateway'

let resolvedGatewayEndpoints: ResolvedSeedGatewayEndpoints | null = null

/** Last endpoints applied during client init (for read-path helpers). */
export function getResolvedSeedGatewayEndpoints(): ResolvedSeedGatewayEndpoints | null {
  return resolvedGatewayEndpoints
}

export function setResolvedSeedGatewayEndpoints(
  value: ResolvedSeedGatewayEndpoints | null,
): void {
  resolvedGatewayEndpoints = value
}
