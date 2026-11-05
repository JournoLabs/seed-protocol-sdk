import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress } from 'viem'
import { easAbi } from './abi/eas'

const realChainClient = await import('./chainClient')
const realConfig = await import('../config')

const SENDER = `0x${'a'.repeat(40)}` as `0x${string}`
const OTHER_SENDER = `0x${'b'.repeat(40)}` as `0x${string}`
const ENTRY_POINT = `0x${'e'.repeat(40)}` as `0x${string}`
const EAS = `0x${'4'.repeat(40)}` as `0x${string}`
const TX = `0x${'1'.repeat(64)}` as `0x${string}`
const POST_SCHEMA = `0x${'5'.repeat(64)}` as `0x${string}`
const VERSION_SCHEMA = `0x${'6'.repeat(64)}` as `0x${string}`
const ROOT_UID = `0x${'7'.repeat(64)}` as `0x${string}`
const SECOND_UID = `0x${'8'.repeat(64)}` as `0x${string}`
const OTHER_UID = `0x${'9'.repeat(64)}` as `0x${string}`
const VERSION_UID = `0x${'c'.repeat(64)}` as `0x${string}`

const entryPointAbi = parseAbi([
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event BeforeExecution()',
])

let chainNonce = 0n
let userOpLog: { transactionHash: `0x${string}`; logIndex: number; args: { nonce: bigint; success: boolean } }
let receiptLogs: unknown[] = []
const getTransactionReceipt = mock(async (_: unknown) => ({ logs: receiptLogs }))
mock.module('./chainClient', () => ({
  ...realChainClient,
  getPublishPublicClient: () => ({
    readContract: async () => chainNonce,
    getLogs: async () => [userOpLog],
    getBlockNumber: async () => 100n,
    getTransactionReceipt,
  }),
}))
mock.module('../config', () => ({ ...realConfig, getPublishConfig: () => ({ easContractAddress: EAS }) }))
const schemaUids: Record<string, string> = { Post: POST_SCHEMA }
mock.module('@seedprotocol/sdk', () => ({
  getEasSchemaUidForModel: async (modelName: string) => schemaUids[modelName],
}))

const { findPublishByNonceKey, pinnedNonce, publishNonceKey } = await import('./pinnedNonce')

const KEY = publishNonceKey('run-7')

function attested(logIndex: number, schemaUID: `0x${string}`, uid: `0x${string}`, attester = SENDER) {
  const topics = encodeEventTopics({ abi: easAbi, eventName: 'Attested', args: { recipient: zeroAddress, attester, schemaUID } })
  return { address: EAS, logIndex, topics, data: encodeAbiParameters([{ type: 'bytes32' }], [uid]) }
}

function entryPointLog(logIndex: number, eventName: 'UserOperationEvent' | 'BeforeExecution') {
  return { address: ENTRY_POINT, logIndex, topics: encodeEventTopics({ abi: entryPointAbi, eventName }), data: '0x' }
}

/** A bundle with another account's UserOp before ours, each attesting a Post Seed. */
function landed(ourLogs: (first: number) => unknown[], success = true) {
  const ours = ourLogs(4)
  const ourEvent = 4 + ours.length
  receiptLogs = [
    entryPointLog(0, 'BeforeExecution'),
    attested(1, POST_SCHEMA, OTHER_UID, OTHER_SENDER),
    attested(2, POST_SCHEMA, OTHER_UID),
    entryPointLog(3, 'UserOperationEvent'),
    ...ours,
    entryPointLog(ourEvent, 'UserOperationEvent'),
    attested(ourEvent + 1, POST_SCHEMA, OTHER_UID),
  ]
  chainNonce = pinnedNonce(KEY) + 1n
  userOpLog = { transactionHash: TX, logIndex: ourEvent, args: { nonce: pinnedNonce(KEY), success } }
}

const find = (modelName?: string) =>
  findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n, entryPoint: ENTRY_POINT, modelName })

describe('findPublishByNonceKey with modelName', () => {
  test('gives the Seed of the model this UserOp attested, not the other UserOps’ in the transaction', async () => {
    landed((i) => [attested(i, POST_SCHEMA, ROOT_UID), attested(i + 1, VERSION_SCHEMA, VERSION_UID)])
    expect(await find('Post')).toEqual({
      sequence: 1n,
      userOp: { transactionHash: TX, success: true, seedUids: [ROOT_UID], seedUid: ROOT_UID },
    })
  })

  test('two new Seeds of the model: both uids and no seedUid', async () => {
    landed((i) => [attested(i, POST_SCHEMA, ROOT_UID), attested(i + 1, POST_SCHEMA, SECOND_UID)])
    const { userOp } = await find('Post')
    expect(userOp?.seedUids).toEqual([ROOT_UID, SECOND_UID])
    expect(userOp?.seedUid).toBeUndefined()
  })

  test('no new Seed of the model: an empty list', async () => {
    landed((i) => [attested(i, VERSION_SCHEMA, VERSION_UID)])
    expect((await find('Post')).userOp).toEqual({ transactionHash: TX, success: true, seedUids: [] })
  })

  test('a reverted UserOp or no modelName reads no receipt', async () => {
    getTransactionReceipt.mockClear()
    landed((i) => [attested(i, POST_SCHEMA, ROOT_UID)], false)
    expect((await find('Post')).userOp).toEqual({ transactionHash: TX, success: false })
    landed((i) => [attested(i, POST_SCHEMA, ROOT_UID)])
    expect((await find()).userOp).toEqual({ transactionHash: TX, success: true })
    expect(getTransactionReceipt).not.toHaveBeenCalled()
  })

  test('a model with no EAS schema uid throws', async () => {
    landed((i) => [attested(i, POST_SCHEMA, ROOT_UID)])
    await expect(find('Article')).rejects.toThrow('no EAS schema uid for model Article')
  })
})
