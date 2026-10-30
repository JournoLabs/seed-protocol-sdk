import type { Hash, Hex } from 'viem'
import { ManagedAccountPublishError } from '../../errors'
import { userOpFailureError } from '../describeRevert'
import type { SeedTxRequest } from '../seedSigner'

/**
 * Headroom on the bundler's callGasLimit, in basis points (1.2x). The bundler's estimate tracks
 * gas used, but the call needs more than that while it runs: refunds are only credited when the
 * transaction ends, and each nested call (EntryPoint → account → executor → EAS) holds back 1/64.
 * EntryPoint v0.6 charges only for gas used, so unused headroom costs nothing.
 */
export const CALL_GAS_HEADROOM_BPS = 12_000n

export type FeesPerGas = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

/**
 * Fee estimate for a UserOp. Asks the bundler with `pimlico_getUserOperationGasPrice` (Pimlico and
 * its Alto bundler answer it, and reject lower fees), and falls back to `fallback` (the chain's own
 * estimate) for a bundler without the method. A bundler that lacks it is remembered per URL.
 */
export function bundlerFeesPerGas(
  bundlerUrl: string,
  fallback: () => Promise<FeesPerGas>,
): () => Promise<FeesPerGas> {
  let hasPimlicoMethod = true
  return async () => {
    if (hasPimlicoMethod) {
      const fast = await pimlicoGasPrice(bundlerUrl)
      if (fast) return fast
      hasPimlicoMethod = false
    }
    return fallback()
  }
}

async function pimlicoGasPrice(bundlerUrl: string): Promise<FeesPerGas | undefined> {
  const res = await fetch(bundlerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pimlico_getUserOperationGasPrice', params: [] }),
  })
  const body = (await res.json().catch(() => undefined)) as
    | { result?: { fast?: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex } } }
    | undefined
  const fast = body?.result?.fast
  if (!fast) return undefined
  return { maxFeePerGas: BigInt(fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(fast.maxPriorityFeePerGas) }
}

type Calls = { calls: { to: Hex; data: Hex; value: bigint }[] }
type Gas = { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint }

/** The smart-account client methods a send uses (permissionless `createSmartAccountClient`). */
export type UserOpClient = {
  estimateUserOperationGas(args: Calls): Promise<Gas>
  sendUserOperation(args: Calls & Partial<Gas>): Promise<Hash>
  waitForUserOperationReceipt(args: { hash: Hash }): Promise<UserOpReceiptLike>
}

/**
 * Sends `tx` as a UserOp with `callGasLimit` raised by {@link CALL_GAS_HEADROOM_BPS} over the
 * bundler's estimate, or to `tx.gas` when that is larger. The limits are set before the paymaster
 * is asked for its data, so a paymaster that signs them signs the raised ones.
 *
 * @returns the bundle transaction's hash
 * @throws ManagedAccountPublishError when the UserOp fails inside a successful bundle
 */
export async function sendUserOpWithHeadroom(
  client: UserOpClient,
  tx: SeedTxRequest,
  sender: string,
): Promise<Hex> {
  const calls = [{ to: tx.to, data: tx.data, value: tx.value ?? 0n }]
  const estimate = await client.estimateUserOperationGas({ calls })
  const raised = (estimate.callGasLimit * CALL_GAS_HEADROOM_BPS) / 10_000n
  const hash = await client.sendUserOperation({
    calls,
    ...estimate,
    callGasLimit: tx.gas != null && tx.gas > raised ? tx.gas : raised,
  })
  const receipt = await client.waitForUserOperationReceipt({ hash })
  return assertUserOpSucceeded(receipt, sender)
}

export type UserOpReceiptLike = { success: boolean; reason?: string; receipt: { transactionHash: Hash } }

/**
 * Returns the transaction hash of a successful UserOp, and throws for a failed one. The
 * bundle transaction itself succeeds when a UserOp in it fails, so its receipt alone would
 * pass a failed publish off as a success.
 * @throws ManagedAccountPublishError `USEROP_REVERTED` or `USEROP_FAILED_NO_REASON`
 * @internal Exported for unit tests.
 */
export function assertUserOpSucceeded(receipt: UserOpReceiptLike, sender?: string): Hex {
  const txHash = receipt.receipt.transactionHash as Hex
  if (receipt.success) return txHash
  const reason = receipt.reason
  if (reason && !/^0x[0-9a-f]*$/i.test(reason)) {
    throw new ManagedAccountPublishError(
      `The publish UserOp in transaction ${txHash} failed: ${reason}`,
      'USEROP_REVERTED',
      sender,
    )
  }
  throw userOpFailureError({ txHash, revertData: reason as Hex | undefined, sender })
}
