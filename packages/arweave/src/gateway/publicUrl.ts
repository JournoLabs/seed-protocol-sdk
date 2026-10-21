import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { getResolvedSeedGatewayEndpoints } from './gatewayState.js'

/**
 * Base URL of the public gateway for links written into published content. The read host
 * ({@link BaseArweaveClient.getBaseUrl}) can be a local Hyper sidecar or an app-server proxy,
 * which nobody else can reach. Before client init resolves endpoints, falls back to the read host.
 */
export function getPublicArweaveBaseUrl(): string {
  return getResolvedSeedGatewayEndpoints()?.publicArweaveBaseUrl ?? BaseArweaveClient.getBaseUrl()
}

/** `{public gateway}/raw/{transactionId}`, for URLs that get uploaded or attested. */
export function getPublicArweaveRawUrl(transactionId: string): string {
  return `${getPublicArweaveBaseUrl()}/raw/${transactionId}`
}
