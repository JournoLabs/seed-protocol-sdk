import { getBlockTimestampMs } from '~/helpers/chainClient'

/**
 * Block time in milliseconds for the receipt's block, or `Date.now()` if unavailable.
 */
export async function attestationMsFromReceipt(
  receipt: { blockNumber?: bigint },
): Promise<number> {
  const bn = receipt?.blockNumber
  if (bn == null) return Date.now()
  const ms = await getBlockTimestampMs(bn)
  return ms ?? Date.now()
}
