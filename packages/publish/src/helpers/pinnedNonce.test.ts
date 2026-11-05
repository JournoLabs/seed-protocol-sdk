import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress } from 'viem'

const realChainClient = await import('./chainClient')

const SENDER = `0x${'a'.repeat(40)}` as `0x${string}`
const ENTRY_POINT = `0x${'e'.repeat(40)}` as `0x${string}`
const TX = `0x${'1'.repeat(64)}` as `0x${string}`

let chainNonce = 0n
let head = 100n
let logs: { blockNumber?: bigint }[] = []
/** Like sepolia.optimism.io: refuses a range over 10,000 blocks, and a range with no end. */
const MAX_SPAN = 10_000n
const getLogs = mock(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock?: bigint }) => {
  if (toBlock === undefined || toBlock - fromBlock + 1n > MAX_SPAN) throw new Error('block range too large')
  return logs.filter((l) => l.blockNumber === undefined || (l.blockNumber >= fromBlock && l.blockNumber <= toBlock))
})
mock.module('./chainClient', () => ({
  ...realChainClient,
  getPublishPublicClient: () => ({ readContract: async () => chainNonce, getLogs, getBlockNumber: async () => head }),
}))

const { findPinnedUserOp, findPublishByNonceKey, nonceKeyForAttempt, pinnedNonce, publishNonceKey, readNonceSequence } =
  await import('./pinnedNonce')

const log = (nonce: bigint, success: boolean) => ({ transactionHash: TX, args: { nonce, success } })

describe('pinned nonces', () => {
  test('an attempt id gives a stable key that fits 192 bits, and differs per attempt', () => {
    const key = nonceKeyForAttempt('attempt1')
    expect(nonceKeyForAttempt('attempt1')).toBe(key)
    expect(nonceKeyForAttempt('attempt2')).not.toBe(key)
    expect(key >> 192n).toBe(0n)
    expect(pinnedNonce(key) & ((1n << 64n) - 1n)).toBe(0n)
    expect(pinnedNonce(key) >> 256n).toBe(0n)
  })

  test('the sequence is the low 64 bits of the EntryPoint nonce', async () => {
    chainNonce = pinnedNonce(9n)
    expect(await readNonceSequence(ENTRY_POINT, SENDER, 9n)).toBe(0n)
    chainNonce = pinnedNonce(9n) + 1n
    expect(await readNonceSequence(ENTRY_POINT, SENDER, 9n)).toBe(1n)
  })

  test('finds the UserOp by its nonce among the sender’s others', async () => {
    logs = [log(pinnedNonce(1n), true), log(pinnedNonce(2n), false)]
    const found = await findPinnedUserOp({ entryPoint: ENTRY_POINT, sender: SENDER, key: 2n, fromBlock: 5n })
    expect(found).toEqual({ transactionHash: TX, success: false })
    expect(getLogs.mock.calls.at(-1)![0]).toMatchObject({ address: ENTRY_POINT, args: { sender: SENDER }, fromBlock: 5n })
  })

  test('finds a UserOp more than 10,000 blocks after fromBlock, reading no range over 10,000', async () => {
    head = 25_000n
    logs = [{ ...log(pinnedNonce(3n), true), blockNumber: 22_500n }]
    getLogs.mockClear()
    const found = await findPinnedUserOp({ entryPoint: ENTRY_POINT, sender: SENDER, key: 3n, fromBlock: 1_000n })
    expect(found).toEqual({ transactionHash: TX, success: true })
    for (const [{ fromBlock, toBlock }] of getLogs.mock.calls) expect(toBlock! - fromBlock + 1n).toBeLessThanOrEqual(MAX_SPAN)
    head = 100n
  })

  test('no such UserOp: undefined', async () => {
    logs = [log(pinnedNonce(1n), true)]
    expect(await findPinnedUserOp({ entryPoint: ENTRY_POINT, sender: SENDER, key: 2n, fromBlock: 5n })).toBeUndefined()
  })

  test('the event shape matches EntryPoint', () => {
    const abi = parseAbi([
      'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
    ])
    expect(encodeEventTopics({ abi, eventName: 'UserOperationEvent' })[0]).toBe(
      '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f',
    )
    expect(encodeAbiParameters([{ type: 'address' }], [zeroAddress])).toHaveLength(66)
  })
})

describe('host nonce keys', () => {
  test('a host key gives a stable 192-bit key, apart from an attempt id with the same text', () => {
    const key = publishNonceKey('run-7')
    expect(publishNonceKey('run-7')).toBe(key)
    expect(publishNonceKey('run-8')).not.toBe(key)
    expect(key).not.toBe(nonceKeyForAttempt('run-7'))
    expect(key >> 192n).toBe(0n)
  })

  test('nothing landed: sequence 0 and no log read', async () => {
    chainNonce = pinnedNonce(publishNonceKey('run-7'))
    getLogs.mockClear()
    expect(await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n })).toEqual({ sequence: 0n })
    expect(getLogs).not.toHaveBeenCalled()
  })

  test('landed: the UserOp, attested or reverted', async () => {
    const key = publishNonceKey('run-7')
    chainNonce = pinnedNonce(key) + 1n
    logs = [log(pinnedNonce(key), false)]
    expect(await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n })).toEqual({
      sequence: 1n,
      userOp: { transactionHash: TX, success: false },
    })
  })
})
