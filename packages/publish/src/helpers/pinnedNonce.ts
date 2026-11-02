import { keccak256, parseAbi, stringToHex, type Address, type Hex } from 'viem'
import { entryPoint06Address } from 'viem/account-abstraction'
import { getPublishPublicClient } from './chainClient'

const entryPointAbi = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
])

const SEQUENCE_MASK = (1n << 64n) - 1n

/**
 * EntryPoint nonces are a 192-bit key and a 64-bit sequence, and a sequence is used once. A UserOp
 * sent with an attempt's own key at sequence 0 can land once however many times it is sent, and
 * reading the sequence afterwards says whether it did, with no hash.
 */
export function nonceKeyForAttempt(attemptId: string): bigint {
  return BigInt(keccak256(stringToHex(attemptId))) >> 64n
}

/**
 * The EntryPoint nonce key for `CreatePublishOptions.nonceKey`: a host's own id for a publish (a job
 * or run id), so every try of that publish sends under one key, from any process, and lands once.
 */
export function publishNonceKey(hostKey: string): bigint {
  return BigInt(keccak256(stringToHex(`seed-publish-nonce-key:${hostKey}`))) >> 64n
}

/** The first nonce under `key`, the one a pinned send uses. */
export function pinnedNonce(key: bigint): bigint {
  return key << 64n
}

/** How many UserOps have landed under `key`. */
export async function readNonceSequence(entryPoint: Address, sender: Address, key: bigint): Promise<bigint> {
  const nonce = await getPublishPublicClient().readContract({
    address: entryPoint,
    abi: entryPointAbi,
    functionName: 'getNonce',
    args: [sender, key],
  })
  return nonce & SEQUENCE_MASK
}

/** The landed UserOp under `key`, from the logs since `fromBlock`. */
export async function findPinnedUserOp(params: {
  entryPoint: Address
  sender: Address
  key: bigint
  fromBlock: bigint
}): Promise<{ transactionHash: Hex; success: boolean } | undefined> {
  const { entryPoint, sender, key, fromBlock } = params
  const logs = await getPublishPublicClient().getLogs({
    address: entryPoint,
    event: entryPointAbi[1],
    args: { sender },
    fromBlock,
  })
  const log = logs.find((l) => l.args.nonce === pinnedNonce(key))
  if (!log?.transactionHash) return undefined
  return { transactionHash: log.transactionHash, success: log.args.success === true }
}

export type PublishByNonceKey = {
  /** How many UserOps have landed under the key: 0 means none, and a send under it can still land. */
  sequence: bigint
  /** The landed UserOp, when `sequence` is above 0 and its event is at or after `fromBlock`. */
  userOp?: { transactionHash: Hex; success: boolean }
}

/**
 * What became of a publish sent with `CreatePublishOptions.nonceKey`, read from EntryPoint with no
 * local rows, for a host whose process restarted. A landed UserOp with `success: false` reverted
 * and attested nothing, but it still spent the key.
 * @param fromBlock a block before the first try; logs are read from there
 * @param entryPoint defaults to EntryPoint v0.6, which ManagedAccounts use
 */
export async function findPublishByNonceKey(params: {
  sender: Address
  nonceKey: string
  fromBlock: bigint
  entryPoint?: Address
}): Promise<PublishByNonceKey> {
  const entryPoint = params.entryPoint ?? entryPoint06Address
  const key = publishNonceKey(params.nonceKey)
  const sequence = await readNonceSequence(entryPoint, params.sender, key)
  if (sequence === 0n) return { sequence }
  const userOp = await findPinnedUserOp({ entryPoint, sender: params.sender, key, fromBlock: params.fromBlock })
  return userOp ? { sequence, userOp } : { sequence }
}
