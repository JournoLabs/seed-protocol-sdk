import { BaseEasClient } from '@seedprotocol/eas'
import type { QueryEasPlatformRegistrar } from '../bootstrap.js'

/**
 * Registers the Node EAS client when nothing else has. Only the EAS client: a query client the
 * host registered stays, and ensureEasPlatform fills one in otherwise.
 */
export const registerNodeEas: QueryEasPlatformRegistrar = async () => {
  const { NodeEasClient } = await import('@seedprotocol/eas/node')
  BaseEasClient.configure(new NodeEasClient())
}
