import './ArweaveClient.js'
import { DEFAULT_ARWEAVE_HOST } from '../constants.js'
import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { NodeArweaveClient } from './ArweaveClient.js'

export { ArweaveClient, NodeArweaveClient } from './ArweaveClient.js'

/** Register Node.js Arweave client and set default read gateway host. */
export function registerNodeArweavePlatform(options?: { arweaveDomain?: string }): void {
  BaseArweaveClient.configure(new NodeArweaveClient())
  BaseArweaveClient.setPreferredReadGateway(options?.arweaveDomain ?? DEFAULT_ARWEAVE_HOST)
}
