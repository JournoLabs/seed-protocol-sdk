import { BaseEasClient } from '@seedprotocol/eas'
import { initializeQueryPlatform, teardownQueryPlatform } from '@seedprotocol/query'

export type InitializeFeedPlatformOptions = {
  arweaveDomain?: string
}

/**
 * Make EAS and Arweave usable for feed generation. Clients a host app or the SDK already
 * registered are kept. With no EAS client registered, the Node one is (see
 * `@seedprotocol/eas/node`); `initializeQueryPlatform` fills in the rest, including the Node
 * Arweave client, and sets the Arweave host when `arweaveDomain` is given.
 */
export async function initializeFeedPlatform(
  options?: InitializeFeedPlatformOptions,
): Promise<void> {
  if (!BaseEasClient.isConfigured()) {
    const { registerNodeEasPlatform } = await import('@seedprotocol/eas/node')
    registerNodeEasPlatform()
  }
  await initializeQueryPlatform(options)
}

/** Lets the next initializeFeedPlatform call run again (tests). Registered clients stay. */
export async function teardownFeedPlatform(): Promise<void> {
  await teardownQueryPlatform()
}

export { DEFAULT_ARWEAVE_HOST } from '@seedprotocol/arweave'
