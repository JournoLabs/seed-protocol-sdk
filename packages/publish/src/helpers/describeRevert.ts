import { BaseError, decodeErrorResult, toFunctionSelector, type Abi, type Hex } from 'viem'
import { easAbi } from './abi/eas'
import { executorModuleAbi } from './abi/executor'
import { seedErrorsAbi } from './abi/seedErrors'

/** Every error a publish call can revert with. `Error(string)` and `Panic` decode without it. */
const publishErrorsAbi = [...seedErrorsAbi, ...executorModuleAbi, ...easAbi] as Abi

export function findRevertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined
  const withData = err.walk((e) => {
    const data = (e as { data?: unknown }).data
    return typeof data === 'string' && data.startsWith('0x') && data.length > 2
  }) as { data?: Hex } | null
  return withData?.data
}

export function isRevert(err: unknown): boolean {
  if (findRevertData(err)) return true
  const msg = err instanceof BaseError ? `${err.shortMessage} ${err.details}` : String(err)
  return /revert/i.test(msg)
}

const NO_DATA_REASON =
  'reverted with no data. The target likely has no matching function or the account cannot run executor calls'

/** "reverted with UnknownPublishLocalId(abc)", decoded with the Seed, executor and EAS errors. */
export function describeRevert(data: Hex | undefined, noDataReason = NO_DATA_REASON): string {
  if (!data || data === '0x') return noDataReason
  try {
    const decoded = decodeErrorResult({ abi: publishErrorsAbi, data })
    const args = decoded.args?.length ? `(${decoded.args.map(String).join(', ')})` : ''
    return `reverted with ${decoded.errorName}${args}`
  } catch {
    return `reverted with data ${data}`
  }
}

/**
 * Message for a UserOp that failed in transaction `txHash`. With no revert data it was usually
 * out of gas: the bundler's callGasLimit estimate was too low, and thirdweb replaces the
 * transaction's own gas limit with that estimate.
 */
export function describeFailedUserOp(txHash: string, revertData?: Hex): string {
  if (revertData && revertData !== '0x') {
    return `The publish UserOp in transaction ${txHash} ${describeRevert(revertData)}.`
  }
  return (
    `The publish UserOp in transaction ${txHash} failed with no revert reason. That usually means it ran out of gas ` +
    `(the bundler's gas estimate was too low), not that the publish data is wrong. ` +
    `To confirm, run \`npx hardhat seed:explain-userop --network <network> --tx ${txHash}\` in seed-protocol.`
  )
}

function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  for (let cur = err; cur && chain.length < 6; cur = (cur as { cause?: unknown }).cause) chain.push(cur)
  return chain
}

let selectorNames: Map<string, string> | undefined
function errorNameForSelector(selector: string): string | undefined {
  selectorNames ??= new Map(
    publishErrorsAbi
      .filter((item) => item.type === 'error')
      .map((item) => [
        toFunctionSelector(`${item.name}(${item.inputs.map((i) => i.type).join(',')})`),
        item.name,
      ]),
  )
  return selectorNames.get(selector.toLowerCase())
}

/**
 * Turns the two unhelpful errors a failed thirdweb UserOp produces into readable ones, keeping
 * the original as `cause`; returns anything else unchanged.
 * - "UserOp failed at txHash: 0x…": no revert reason was logged, usually out of gas.
 * - viem's AbiErrorSignatureNotFoundError: thirdweb decodes the logged revert reason without
 *   an ABI, so every custom error fails to decode. Names the error from its selector.
 */
export function explainUserOpError(err: unknown): unknown {
  for (const e of errorChain(err)) {
    const message = String((e as { message?: unknown }).message ?? '')
    const failed = message.match(/UserOp failed at txHash: (0x[0-9a-f]{64})/i)
    if (failed) return new Error(describeFailedUserOp(failed[1]!), { cause: err })

    const signature = (e as { name?: unknown; signature?: unknown }).signature
    if ((e as { name?: unknown }).name === 'AbiErrorSignatureNotFoundError' && typeof signature === 'string') {
      const name = errorNameForSelector(signature)
      if (name) {
        return new Error(
          `The publish transaction reverted with ${name} (its arguments were not decoded).`,
          { cause: err },
        )
      }
    }
  }
  return err
}
