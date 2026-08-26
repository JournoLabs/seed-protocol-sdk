import './ArweaveClient.js'
import { DEFAULT_ARWEAVE_HOST } from '../constants.js'
import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'

export { ArweaveClient } from './ArweaveClient.js'

/** Register Node.js Arweave client and set default read gateway host. */
export function registerNodeArweavePlatform(options?: { arweaveDomain?: string }): void {
  BaseArweaveClient.setPreferredReadGateway(options?.arweaveDomain ?? DEFAULT_ARWEAVE_HOST)
}
