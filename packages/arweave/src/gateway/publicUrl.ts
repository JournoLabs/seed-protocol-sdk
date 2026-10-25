import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { DEFAULT_ARWEAVE_HOST, resolveArweaveHostFromEnv } from '../constants.js'
import { getResolvedSeedGatewayEndpoints } from './gatewayState.js'

/** A loopback address: a local Hyper sidecar, which nobody else can reach. */
function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)
  } catch {
    return true
  }
}

/**
 * Base URL of the public gateway for links written into published content and feeds. Once client
 * init resolves endpoints, it is their public gateway (`arweaveDomain`), whatever the read path.
 * Before that, the read host (`BaseArweaveClient.getBaseUrl()`, set by `setHost` or a query or
 * feed bootstrap's `arweaveDomain`), unless it is a loopback sidecar address; then the env host
 * (`ARWEAVE_HOST` and the like) or {@link DEFAULT_ARWEAVE_HOST}.
 */
export function getPublicArweaveBaseUrl(): string {
  const resolved = getResolvedSeedGatewayEndpoints()?.publicArweaveBaseUrl
  if (resolved) return resolved
  const read = BaseArweaveClient.getBaseUrl()
  if (!isLoopbackUrl(read)) return read
  return `https://${resolveArweaveHostFromEnv() || DEFAULT_ARWEAVE_HOST}`
}

/** `{public gateway}/raw/{transactionId}`, for URLs that get uploaded or attested. */
export function getPublicArweaveRawUrl(transactionId: string): string {
  return `${getPublicArweaveBaseUrl()}/raw/${transactionId}`
}
