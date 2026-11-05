import { encodeEventTopics, keccak256, parseAbi, stringToHex, type Address, type Hex } from 'viem'
import { entryPoint06Address } from 'viem/account-abstraction'
import { getPublishConfig } from '../config'
import { getPublishPublicClient } from './chainClient'

const entryPointAbi = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event BeforeExecution()',
])

// EntryPoint emits BeforeExecution once validation of the bundle is done, then runs each UserOp and
// emits its UserOperationEvent, so a UserOp's own logs lie between the boundary before it and its event.
const userOpBoundaryTopics = new Set<string>([
  encodeEventTopics({ abi: entryPointAbi, eventName: 'UserOperationEvent' })[0]!,
  encodeEventTopics({ abi: entryPointAbi, eventName: 'BeforeExecution' })[0]!,
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

type PinnedUserOpParams = {
  entryPoint: Address
  sender: Address
  key: bigint
  fromBlock: bigint
}

/** The widest block range one `eth_getLogs` asks for: public RPCs such as sepolia.optimism.io refuse more. */
const LOG_SPAN = 10_000n

async function findPinnedUserOpLog(params: PinnedUserOpParams) {
  const { entryPoint, sender, key, fromBlock } = params
  const client = getPublishPublicClient()
  const head = await client.getBlockNumber()
  const nonce = pinnedNonce(key)
  for (let from = fromBlock; from <= head; from += LOG_SPAN) {
    const to = from + LOG_SPAN - 1n < head ? from + LOG_SPAN - 1n : head
    const logs = await client.getLogs({
      address: entryPoint,
      event: entryPointAbi[1],
      args: { sender },
      fromBlock: from,
      toBlock: to,
    })
    const log = logs.find((l) => l.args.nonce === nonce)
    if (log?.transactionHash) return log
  }
  return undefined
}

/** The landed UserOp under `key`, from the logs since `fromBlock`, read 10,000 blocks at a time. */
export async function findPinnedUserOp(
  params: PinnedUserOpParams,
): Promise<{ transactionHash: Hex; success: boolean } | undefined> {
  const log = await findPinnedUserOpLog(params)
  if (!log) return undefined
  return { transactionHash: log.transactionHash!, success: log.args.success === true }
}

type ReceiptLog = { address: string; logIndex: number | null; topics: readonly unknown[] }

/** The receipt's logs emitted while the UserOp whose UserOperationEvent is at `userOpLogIndex` ran. */
function logsOfUserOp<L extends ReceiptLog>(logs: readonly L[], entryPoint: Address, userOpLogIndex: number): L[] {
  const ep = entryPoint.toLowerCase()
  let start = -1
  for (const l of logs) {
    if (l.logIndex == null || l.logIndex >= userOpLogIndex) continue
    if (l.address.toLowerCase() === ep && userOpBoundaryTopics.has(String(l.topics[0]))) {
      start = Math.max(start, l.logIndex)
    }
  }
  return logs.filter((l) => l.logIndex != null && l.logIndex > start && l.logIndex < userOpLogIndex)
}

/** The uids of the Seeds of `modelName` that `sender` attested in the UserOp. */
async function seedUidsOfUserOp(params: {
  entryPoint: Address
  sender: Address
  transactionHash: Hex
  userOpLogIndex: number
  modelName: string
}): Promise<string[]> {
  const { getEasSchemaUidForModel } = await import('@seedprotocol/sdk')
  const { getAttestedUidsFromReceipt } = await import('./easDirect')
  const schemaUid = await getEasSchemaUidForModel(params.modelName)
  if (!schemaUid) throw new Error(`findPublishByNonceKey: no EAS schema uid for model ${params.modelName}`)
  const receipt = await getPublishPublicClient().getTransactionReceipt({ hash: params.transactionHash })
  const logs = logsOfUserOp(receipt.logs, params.entryPoint, params.userOpLogIndex)
  return getAttestedUidsFromReceipt({ logs }, getPublishConfig().easContractAddress, params.sender)
    .filter((a) => a.schemaUid.toLowerCase() === schemaUid.toLowerCase())
    .map((a) => a.uid)
}

export type PublishByNonceKey = {
  /** How many UserOps have landed under the key: 0 means none, and a send under it can still land. */
  sequence: bigint
  /** The landed UserOp, when `sequence` is above 0 and its event is at or after `fromBlock`. */
  userOp?: {
    transactionHash: Hex
    success: boolean
    /**
     * With `modelName` and `success`: the uids of the new Seeds of that model the sender attested in
     * this UserOp, other UserOps in the same transaction left out. Empty when the publish made no new
     * Seed of it, as when the item was already published.
     */
    seedUids?: string[]
    /** `seedUids[0]` when it holds exactly one uid: the root Seed when `modelName` is the root's model. */
    seedUid?: string
  }
}

/**
 * What became of a publish sent with `CreatePublishOptions.nonceKey`, read from EntryPoint with no
 * local rows, for a host whose process restarted. A landed UserOp with `success: false` reverted
 * and attested nothing, but it still spent the key.
 * @param fromBlock a block before the first try; logs are read from there
 * @param entryPoint defaults to EntryPoint v0.6, which ManagedAccounts use
 * @param modelName the published item's model: a successful UserOp then carries `seedUids` and
 *   `seedUid`, read from its transaction's `Attested` events on that model's Seed schema with the
 *   sender as attester. Throws when the model has no EAS schema uid.
 */
export async function findPublishByNonceKey(params: {
  sender: Address
  nonceKey: string
  fromBlock: bigint
  entryPoint?: Address
  modelName?: string
}): Promise<PublishByNonceKey> {
  const entryPoint = params.entryPoint ?? entryPoint06Address
  const { sender, modelName } = params
  const key = publishNonceKey(params.nonceKey)
  const sequence = await readNonceSequence(entryPoint, sender, key)
  if (sequence === 0n) return { sequence }
  const log = await findPinnedUserOpLog({ entryPoint, sender, key, fromBlock: params.fromBlock })
  if (!log) return { sequence }
  const userOp: NonNullable<PublishByNonceKey['userOp']> = {
    transactionHash: log.transactionHash!,
    success: log.args.success === true,
  }
  if (modelName && userOp.success && log.logIndex != null) {
    userOp.seedUids = await seedUidsOfUserOp({
      entryPoint,
      sender,
      transactionHash: userOp.transactionHash,
      userOpLogIndex: log.logIndex,
      modelName,
    })
    if (userOp.seedUids.length === 1) userOp.seedUid = userOp.seedUids[0]
  }
  return { sequence, userOp }
}
