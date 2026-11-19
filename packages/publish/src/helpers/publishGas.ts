import { BaseError, parseEther, type Address } from 'viem'
import { getPublishPublicClient } from './chainClient'
import { ManagedAccountPublishError } from '../errors'
import { maxPublishGas } from './publishSize'
import type { SeedTxRequest } from './seedSigner'

/** The gas a publish is sent with when its estimate can't be made (the fixed limit before estimates). */
export const PUBLISH_GAS_FALLBACK = 5_000_000n
/** Headroom on the estimate, in basis points: state can change between estimate and inclusion. */
export const PUBLISH_GAS_HEADROOM_BPS = 13_000n

const errorText = (err: unknown) =>
  err instanceof BaseError ? `${err.shortMessage} ${err.details} ${err.message}` : String(err)
const isInsufficientFunds = (err: unknown): boolean => /insufficient funds|insufficient balance/i.test(errorText(err))
/** The node ran the call out of gas at the most it allows: its cap, or what the balance pays for. */
const exceedsAllowance = (err: unknown): boolean => /gas required exceeds allowance/i.test(errorText(err))

/**
 * A gas estimate with headroom; `'over_cap'` when the node runs the call out of gas at the most it
 * allows, even with a funded sender; `undefined` when it can't be made.
 */
export type PublishGasEstimate = bigint | 'over_cap' | undefined

const withHeadroom = (gas: bigint) => (gas * PUBLISH_GAS_HEADROOM_BPS) / 10_000n
const lower = (a: bigint, b: bigint) => (a < b ? a : b)

/**
 * The most gas one publish transaction may use: {@link maxPublishGas}, or the block gas limit when
 * that is lower. A failed block read keeps the configured limit.
 */
export async function publishGasCeiling(): Promise<bigint> {
  let blockGasLimit: bigint | undefined
  try {
    blockGasLimit = (await getPublishPublicClient().getBlock()).gasLimit
  } catch {
    blockGasLimit = undefined
  }
  return blockGasLimit === undefined ? maxPublishGas() : lower(maxPublishGas(), blockGasLimit)
}

/**
 * `tx`'s gas estimate from `from`, plus {@link PUBLISH_GAS_HEADROOM_BPS}. An unfunded sender is
 * estimated again with a balance override: OP chains charge the L1 data fee up front, as in
 * simulateCallFromAccount. "gas required exceeds allowance" can mean a low balance too, so it is
 * estimated again the same way, and is `'over_cap'` only when that fails the same way.
 * `undefined` when the estimate can't be made for any other reason.
 */
export async function estimatePublishGas(from: string, tx: SeedTxRequest): Promise<PublishGasEstimate> {
  const estimate = (withBalance: boolean) =>
    getPublishPublicClient().estimateGas({
      account: from as Address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      ...(withBalance ? { stateOverride: [{ address: from as Address, balance: parseEther('1000') }] } : {}),
    })
  try {
    return withHeadroom(await estimate(false))
  } catch (err) {
    if (!isInsufficientFunds(err) && !exceedsAllowance(err)) return undefined
  }
  try {
    return withHeadroom(await estimate(true))
  } catch (err) {
    return exceedsAllowance(err) ? 'over_cap' : undefined
  }
}

/**
 * The gas limit to send `tx` from `from` with: {@link estimatePublishGas}. When the estimate can't
 * be made it is {@link PUBLISH_GAS_FALLBACK}, or `localEstimate` with headroom when that is higher,
 * never above {@link maxPublishGas}. An estimate over {@link publishGasCeiling}, or over the node's
 * own cap (`'over_cap'`), throws `PUBLISH_TOO_LARGE` before anything is sent; the part was fitted
 * to the ceiling already, so this is the last check. Call it after the transaction's simulation passed: a revert here is not
 * reported as one.
 */
export async function publishGasLimit(from: string, tx: SeedTxRequest, localEstimate = 0n): Promise<bigint> {
  const gas = await estimatePublishGas(from, tx)
  if (gas === 'over_cap') {
    throw new ManagedAccountPublishError(
      'This transaction needs more gas than the node allows for one transaction; nothing was sent.',
      'PUBLISH_TOO_LARGE',
      from,
    )
  }
  if (gas === undefined) {
    const local = withHeadroom(localEstimate)
    return lower(local > PUBLISH_GAS_FALLBACK ? local : PUBLISH_GAS_FALLBACK, maxPublishGas())
  }
  const limit = await publishGasCeiling()
  if (gas > limit) {
    throw new ManagedAccountPublishError(
      `This transaction needs about ${gas} gas, over the limit of ${limit}; nothing was sent.`,
      'PUBLISH_TOO_LARGE',
      from,
    )
  }
  return gas
}
