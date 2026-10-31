import { BaseError, parseEther, type Address } from 'viem'
import { getPublishPublicClient } from './chainClient'
import { ManagedAccountPublishError } from '../errors'
import { maxPublishGas } from './publishSize'
import type { SeedTxRequest } from './seedSigner'

/** The gas a publish is sent with when its estimate can't be made (the fixed limit before estimates). */
export const PUBLISH_GAS_FALLBACK = 5_000_000n
/** Headroom on the estimate, in basis points: state can change between estimate and inclusion. */
export const PUBLISH_GAS_HEADROOM_BPS = 13_000n

const isInsufficientFunds = (err: unknown): boolean => {
  const msg = err instanceof BaseError ? `${err.shortMessage} ${err.details} ${err.message}` : String(err)
  return /insufficient funds|insufficient balance/i.test(msg)
}

const withHeadroom = (gas: bigint) => (gas * PUBLISH_GAS_HEADROOM_BPS) / 10_000n
const lower = (a: bigint, b: bigint) => (a < b ? a : b)

/**
 * The gas limit to send `tx` from `from` with: its estimate plus {@link PUBLISH_GAS_HEADROOM_BPS}.
 * When the estimate can't be made it is {@link PUBLISH_GAS_FALLBACK}, or `localEstimate` with
 * headroom when that is higher, never above {@link maxPublishGas}. A whole publish graph goes in one
 * transaction, so a large one can need more than that limit or a block holds; that throws
 * `PUBLISH_TOO_LARGE` before anything is sent. Call it after the transaction's simulation passed:
 * a revert here is not reported as one.
 */
export async function publishGasLimit(from: string, tx: SeedTxRequest, localEstimate = 0n): Promise<bigint> {
  const client = getPublishPublicClient()
  const estimate = (withBalance: boolean) =>
    client.estimateGas({
      account: from as Address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      // OP chains charge the L1 data fee up front, as in simulateCallFromAccount.
      ...(withBalance ? { stateOverride: [{ address: from as Address, balance: parseEther('1000') }] } : {}),
    })
  let estimated: bigint
  try {
    try {
      estimated = await estimate(false)
    } catch (err) {
      if (!isInsufficientFunds(err)) throw err
      estimated = await estimate(true)
    }
  } catch {
    const local = withHeadroom(localEstimate)
    return lower(local > PUBLISH_GAS_FALLBACK ? local : PUBLISH_GAS_FALLBACK, maxPublishGas())
  }
  const gas = withHeadroom(estimated)
  const { gasLimit: blockGasLimit } = await client.getBlock()
  const limit = lower(maxPublishGas(), blockGasLimit)
  if (gas > limit) {
    throw new ManagedAccountPublishError(
      `This publish needs about ${gas} gas, over the limit of ${limit}; nothing was sent. ` +
        'Publish some of its related drafts on their own first.',
      'PUBLISH_TOO_LARGE',
      from,
    )
  }
  return gas
}
