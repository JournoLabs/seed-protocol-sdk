import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress } from 'viem'

const realChainClient = await import('./chainClient')

const SENDER = `0x${'a'.repeat(40)}` as `0x${string}`
const ENTRY_POINT = `0x${'e'.repeat(40)}` as `0x${string}`
const TX = `0x${'1'.repeat(64)}` as `0x${string}`

let chainNonce = 0n
/** EntryPoint nonces by key, for reads that name a key; any other key reads `chainNonce`. */
let noncesByKey = new Map<bigint, bigint>()
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
  getPublishPublicClient: () => ({
    readContract: async ({ args }: { args: [string, bigint] }) => noncesByKey.get(args[1]) ?? chainNonce,
    getLogs,
    getBlockNumber: async () => head,
  }),
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

  test('part 1 keeps the key a host already uses', () => {
    // The key publishes sent before splitting existed: a host's landed UserOps stay findable.
    expect(publishNonceKey('run-7')).toBe(2489447104722643901636023200252504100820985383673806874650n)
    expect(publishNonceKey('run-7', 1)).toBe(publishNonceKey('run-7'))
  })

  test('each later part has its own key', () => {
    const keys = [1, 2, 3].map((part) => publishNonceKey('run-7', part))
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) expect(key >> 192n).toBe(0n)
    expect(publishNonceKey('run-7', 2)).not.toBe(publishNonceKey('run-8', 2))
  })

  /** `sequence` UserOps landed under part `part`'s key. */
  const landed = (part: number, sequence: bigint) => {
    const key = publishNonceKey('run-7', part)
    noncesByKey.set(key, pinnedNonce(key) + sequence)
    return key
  }

  test('nothing landed: sequence 0 and no log read', async () => {
    noncesByKey = new Map()
    landed(1, 0n)
    getLogs.mockClear()
    expect(await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n })).toEqual({
      sequence: 0n,
      parts: [],
    })
    expect(getLogs).not.toHaveBeenCalled()
  })

  // Batch 17 item 6 (D61)
  describe('maxBlocks', () => {
    const landedOnce = () => {
      noncesByKey = new Map()
      const key = landed(1, 1n)
      landed(2, 0n)
      logs = [log(pinnedNonce(key), true)]
    }

    test('refuses a fromBlock over 1,000,000 blocks back, naming the option, before any log read', async () => {
      landedOnce()
      head = 2_000_000n
      getLogs.mockClear()
      try {
        const read = findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 0n })
        await expect(read).rejects.toBeInstanceOf(RangeError)
        await expect(read).rejects.toThrow(/maxBlocks/)
        expect(getLogs).not.toHaveBeenCalled()
        // 1,000,000 back is still allowed
        await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1_000_000n })
      } finally {
        head = 100n
      }
    })

    test('a bigint changes the cap', async () => {
      landedOnce()
      head = 100n
      await expect(findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n, maxBlocks: 10n })).rejects.toThrow(
        RangeError,
      )
      expect((await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 90n, maxBlocks: 10n })).userOp)
        .toMatchObject({ transactionHash: TX, success: true })
    })

    test('Infinity removes it', async () => {
      landedOnce()
      head = 2_000_000n
      try {
        const found = await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 0n, maxBlocks: Infinity })
        expect(found.userOp).toMatchObject({ transactionHash: TX })
      } finally {
        head = 100n
      }
    })

    // Batch 18 item 2 (D66): 0.8.2 answered { sequence: 0n } for a key nothing landed under
    test('a key nothing landed under answers sequence 0 from any fromBlock', async () => {
      noncesByKey = new Map()
      landed(1, 0n)
      head = 5_000_000n
      getLogs.mockClear()
      try {
        expect(await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 0n })).toEqual({
          sequence: 0n,
          parts: [],
        })
        expect(getLogs).not.toHaveBeenCalled()
      } finally {
        head = 100n
      }
    })

    // Batch 18 item 3: the type said `number` and the function threw a TypeError for it
    test('a finite number changes the cap like a bigint', async () => {
      landedOnce()
      head = 100n
      await expect(
        findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n, maxBlocks: 10 }),
      ).rejects.toBeInstanceOf(RangeError)
      expect(
        (await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 90n, maxBlocks: 10 })).userOp,
      ).toMatchObject({ transactionHash: TX, success: true })
    })

    test('NaN and a negative number are refused', async () => {
      for (const maxBlocks of [NaN, -1, -Infinity]) {
        await expect(
          findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n, maxBlocks }),
        ).rejects.toBeInstanceOf(TypeError)
      }
    })
  })

  test('landed: the UserOp, attested or reverted', async () => {
    noncesByKey = new Map()
    const key = landed(1, 1n)
    landed(2, 0n)
    logs = [log(pinnedNonce(key), false)]
    const userOp = { transactionHash: TX, success: false }
    expect(await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n })).toEqual({
      sequence: 1n,
      userOp,
      parts: [{ part: 1, sequence: 1n, userOp }],
    })
  })

  test('findPublishByNonceKey lists every landed part', async () => {
    noncesByKey = new Map()
    const first = landed(1, 1n)
    const second = landed(2, 1n)
    landed(3, 0n)
    const TX2 = `0x${'2'.repeat(64)}` as `0x${string}`
    logs = [log(pinnedNonce(first), true), { transactionHash: TX2, args: { nonce: pinnedNonce(second), success: true } }]
    const found = await findPublishByNonceKey({ sender: SENDER, nonceKey: 'run-7', fromBlock: 1n })
    expect(found.parts.length).toBe(2)
    expect(found.parts.map((p) => p.userOp?.transactionHash)).toEqual([TX, TX2])
    expect(found.sequence).toBe(1n)
    expect(found.userOp?.transactionHash).toBe(TX)
  })
})
