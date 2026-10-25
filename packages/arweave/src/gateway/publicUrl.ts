import { DEFAULT_ARWEAVE_HOST, resolveArweaveHostFromEnv } from '../constants.js'
import { getResolvedSeedGatewayEndpoints } from './gatewayState.js'

/**
 * Base URL of the public gateway for links written into published content. The read host
 * (`BaseArweaveClient.getBaseUrl()`) can be a local Hyper sidecar or an app-server proxy,
 * which nobody else can reach, so it is never used here: before client init resolves endpoints,
 * this is the env host (`ARWEAVE_HOST` and the like) or {@link DEFAULT_ARWEAVE_HOST}.
 */
export function getPublicArweaveBaseUrl(): string {
  return (
    getResolvedSeedGatewayEndpoints()?.publicArweaveBaseUrl ??
    `https://${resolveArweaveHostFromEnv() || DEFAULT_ARWEAVE_HOST}`
  )
}

/** `{public gateway}/raw/{transactionId}`, for URLs that get uploaded or attested. */
export function getPublicArweaveRawUrl(transactionId: string): string {
  return `${getPublicArweaveBaseUrl()}/raw/${transactionId}`
}
