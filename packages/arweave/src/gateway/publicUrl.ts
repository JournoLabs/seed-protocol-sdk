import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { DEFAULT_ARWEAVE_HOST, resolveArweaveHostFromEnv } from '../constants.js'
import { getResolvedSeedGatewayEndpoints } from './gatewayState.js'

/**
 * A read host only this reader uses: a loopback address (a local Hyper sidecar, which nobody else
 * can reach) or a URL with a path prefix (an app proxy such as `app.example/api/seed-gateway`).
 */
function isPrivateReadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)) return true
    return parsed.pathname.replace(/\/+$/, '') !== ''
  } catch {
    return true
  }
}

/**
 * Base URL of the public gateway for links written into published content and feeds. Once client
 * init resolves endpoints, it is their public gateway (`arweaveDomain`), whatever the read path.
 * Before that, the read host (`BaseArweaveClient.getBaseUrl()`, set by `setHost` or a query or
 * feed bootstrap's `arweaveDomain`) when it is a gateway's root; a loopback sidecar address or a
 * URL with a path prefix (an app proxy) gives the env host (`ARWEAVE_HOST` and the like) or
 * {@link DEFAULT_ARWEAVE_HOST} instead.
 */
export function getPublicArweaveBaseUrl(): string {
  const resolved = getResolvedSeedGatewayEndpoints()?.publicArweaveBaseUrl
  if (resolved) return resolved
  const read = BaseArweaveClient.getBaseUrl()
  if (!isPrivateReadUrl(read)) return read
  return `https://${resolveArweaveHostFromEnv() || DEFAULT_ARWEAVE_HOST}`
}

/** `{public gateway}/raw/{transactionId}`, for URLs that get uploaded or attested. */
export function getPublicArweaveRawUrl(transactionId: string): string {
  return `${getPublicArweaveBaseUrl()}/raw/${transactionId}`
}
