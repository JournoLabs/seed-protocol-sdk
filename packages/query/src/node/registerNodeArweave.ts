import type { QueryArweavePlatformRegistrar } from '../bootstrap.js'

/** Registers the Node Arweave client (and read gateway) when nothing else has. */
export const registerNodeArweave: QueryArweavePlatformRegistrar = async ({ arweaveDomain }) => {
  const { registerNodeArweavePlatform } = await import('@seedprotocol/arweave/node')
  registerNodeArweavePlatform({ arweaveDomain })
}
