import { getAbiItem, toFunctionSelector, zeroAddress, type Address, type Hex } from 'viem'
import { multiPublishAbi } from './abi/publisher'
import { managedAccountFactoryAbi } from './abi/factory'
import { getPublishPublicClient } from './chainClient'
import { ManagedAccountPublishError } from '../errors'

/** The `multiPublish` selector this package sends: the three-phase multiPublish (0xa1263421). */
export const MULTI_PUBLISH_SELECTOR: Hex = toFunctionSelector(getAbiItem({ abi: multiPublishAbi, name: 'multiPublish' }))

/** The `multiPublish` of contracts from before the three-phase multiPublish. */
const PRE_REFERENCES_MULTI_PUBLISH_SELECTOR: Hex = '0x2a29fadc'

const routedOn = async (account: Address, selector: Hex): Promise<boolean> =>
  (await getPublishPublicClient().readContract({
    address: account,
    abi: managedAccountFactoryAbi,
    functionName: 'getImplementationForFunction',
    args: [selector],
  })) !== zeroAddress

/**
 * Throws `MULTI_PUBLISH_NOT_ROUTED` when `target` can't take the `multiPublish` this package sends,
 * so a version mismatch between the SDK and the deployed contracts is reported as one instead of a
 * Router revert. A ManagedAccount (`executorModule` false) is asked its route for the selector,
 * which its factory answers. The executor module is checked for the selector in its bytecode,
 * where Solidity's dispatcher holds it. When the check can't run (no Router, no code, an RPC
 * error) it passes, and the simulation decides.
 */
export async function assertMultiPublishRouted(target: string, { executorModule }: { executorModule: boolean }): Promise<void> {
  const address = target as Address
  let routed: boolean
  let routesOld = false
  try {
    if (executorModule) {
      const code = await getPublishPublicClient().getCode({ address })
      if (!code || code === '0x') return
      routed = code.toLowerCase().includes(MULTI_PUBLISH_SELECTOR.slice(2))
      routesOld = code.toLowerCase().includes(PRE_REFERENCES_MULTI_PUBLISH_SELECTOR.slice(2))
    } else {
      routed = await routedOn(address, MULTI_PUBLISH_SELECTOR)
      if (!routed) routesOld = await routedOn(address, PRE_REFERENCES_MULTI_PUBLISH_SELECTOR)
    }
  } catch {
    return
  }
  if (routed) return
  const what = executorModule ? 'The executor module' : 'The account'
  throw new ManagedAccountPublishError(
    `${what} ${target} has no multiPublish ${MULTI_PUBLISH_SELECTOR}, the three-phase multiPublish this version of ` +
      '@seedprotocol/publish sends' +
      (routesOld ? `; it has ${PRE_REFERENCES_MULTI_PUBLISH_SELECTOR}, the multiPublish of contracts from before it` : '') +
      '. The deployed contracts and this SDK are different versions; nothing was sent.',
    'MULTI_PUBLISH_NOT_ROUTED',
    target,
  )
}
