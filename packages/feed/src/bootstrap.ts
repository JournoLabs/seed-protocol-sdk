import { initializeQueryPlatform, teardownQueryPlatform } from '@seedprotocol/query'

export type InitializeFeedPlatformOptions = {
  arweaveDomain?: string
}

/**
 * Make EAS and Arweave usable for feed generation (via `initializeQueryPlatform`). Clients a host
 * app or the SDK already registered are kept; otherwise the Node EAS and Arweave clients are
 * registered. `arweaveDomain` sets the Arweave host.
 */
export async function initializeFeedPlatform(
  options?: InitializeFeedPlatformOptions,
): Promise<void> {
  await initializeQueryPlatform(options)
}

/** Lets the next initializeFeedPlatform call run again (tests). Registered clients stay. */
export async function teardownFeedPlatform(): Promise<void> {
  await teardownQueryPlatform()
}

export { DEFAULT_ARWEAVE_HOST } from '@seedprotocol/arweave'
