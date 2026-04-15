import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { eth_getBlockByNumber, getRpcClient } from 'thirdweb/rpc'

/**
 * Block time in milliseconds for the receipt's block, or `Date.now()` if unavailable.
 */
export async function attestationMsFromReceipt(
  client: ThirdwebClient,
  chain: Chain,
  receipt: { blockNumber?: bigint },
): Promise<number> {
  const bn = receipt?.blockNumber
  if (bn == null) return Date.now()
  try {
    const rpc = getRpcClient({ client, chain })
    const block = await eth_getBlockByNumber(rpc, { blockNumber: bn })
    const ts = block?.timestamp
    if (ts != null) return Number(ts) * 1000
  } catch {
    // ignore
  }
  return Date.now()
}
