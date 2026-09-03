import {
  DEFAULT_ARWEAVE_HOST,
  resolveArweaveHostFromEnv,
} from '@seedprotocol/arweave'

let initialized = false

export type InitializeQueryPlatformOptions = {
  arweaveDomain?: string
}

function resolveQueryArweaveDomain(explicit?: string): string {
  return explicit ?? resolveArweaveHostFromEnv() ?? DEFAULT_ARWEAVE_HOST
}

/** Register Node EAS + Arweave clients for remote query (no full SDK client). */
export async function initializeQueryPlatform(
  options?: InitializeQueryPlatformOptions,
): Promise<void> {
  if (initialized) return
  const [{ registerNodeEasPlatform }, { registerNodeArweavePlatform }] = await Promise.all([
    import('@seedprotocol/eas/node'),
    import('@seedprotocol/arweave/node'),
  ])
  registerNodeEasPlatform()
  const arweaveDomain = resolveQueryArweaveDomain(options?.arweaveDomain)
  registerNodeArweavePlatform({ arweaveDomain })
  if (options?.arweaveDomain) {
    const { BaseArweaveClient } = await import('@seedprotocol/arweave')
    BaseArweaveClient.setHost(options.arweaveDomain)
  }
  initialized = true
}

export async function teardownQueryPlatform(): Promise<void> {
  initialized = false
}

export function isQueryPlatformInitialized(): boolean {
  return initialized
}

export { DEFAULT_ARWEAVE_HOST } from '@seedprotocol/arweave'
