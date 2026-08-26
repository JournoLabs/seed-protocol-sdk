import { DEFAULT_ARWEAVE_HOST, resolveArweaveHostFromEnv } from '@seedprotocol/arweave'

let initialized = false

export type InitializeFeedPlatformOptions = {
  arweaveDomain?: string
}

function resolveFeedArweaveDomain(explicit?: string): string {
  return explicit ?? resolveArweaveHostFromEnv() ?? DEFAULT_ARWEAVE_HOST
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
  const arweaveDomain = resolveFeedArweaveDomain(options?.arweaveDomain)
  registerNodeArweavePlatform({ arweaveDomain })
  if (options?.arweaveDomain) {
    const { BaseArweaveClient } = await import('@seedprotocol/arweave')
    BaseArweaveClient.setHost(options.arweaveDomain)
  }
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
