import { DEFAULT_ARWEAVE_HOST } from '@seedprotocol/arweave'

let initialized = false

export type InitializeFeedPlatformOptions = {
  arweaveDomain?: string
}

/** Register Node EAS + Arweave clients for feed generation (no full SDK client). */
export async function initializeFeedPlatform(
  options?: InitializeFeedPlatformOptions,
): Promise<void> {
  if (initialized) return
  const [{ registerNodeEasPlatform }, { registerNodeArweavePlatform }] = await Promise.all([
    import('@seedprotocol/eas/node'),
    import('@seedprotocol/arweave/node'),
  ])
  registerNodeEasPlatform()
  registerNodeArweavePlatform({
    arweaveDomain: options?.arweaveDomain ?? DEFAULT_ARWEAVE_HOST,
  })
  initialized = true
}

/** @deprecated Use initializeFeedPlatform */
export const initializeSeedClient = initializeFeedPlatform

export async function getClient(): Promise<{ isInitialized: () => boolean }> {
  await initializeFeedPlatform()
  return { isInitialized: () => initialized }
}

export async function teardownSeedClient(): Promise<void> {
  initialized = false
}

export { DEFAULT_ARWEAVE_HOST } from '@seedprotocol/arweave'
