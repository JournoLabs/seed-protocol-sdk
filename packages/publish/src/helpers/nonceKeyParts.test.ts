import { describe, expect, mock, test } from 'bun:test'

/**
 * Batch 18 item 30a (D68): the parts of a split publish under a host nonceKey are counted from
 * the attempt rows that sent under the part keys, whichever run sent them.
 */
const realSdk = await import('@seedprotocol/sdk')
type Row = { id: string; status: string; txHash: string | null; seedLocalId: string; requests: string }
/** Rows by the decimal nonce key they sent under. */
let rowsByKey = new Map<string, Row[]>()
const reads: string[] = []
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findPublishAttemptsByNonceKey: async (key: string) => {
    reads.push(key)
    return rowsByKey.get(key) ?? []
  },
}))

const { partsSentUnderNonceKey } = await import('./nonceKeyParts')
const { publishNonceKey } = await import('./pinnedNonce')

const under = (hostKey: string, part: number, ...rows: Row[]) => rowsByKey.set(publishNonceKey(hostKey, part).toString(), rows)
const recorded = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  status: 'recorded',
  txHash: `0x${id}`,
  seedLocalId: 'post0001',
  requests: JSON.stringify([{ localId: 'author001' }]),
  ...extra,
})
const rootPart = JSON.stringify([{ localId: 'author001' }, { localId: 'post0001' }])
const context = (nonceKey: string | undefined) => ({ nonceKey, item: { seedLocalId: 'post0001' } }) as never

describe('partsSentUnderNonceKey', () => {
  test('is 0 without a host nonceKey and reads nothing', async () => {
    rowsByKey = new Map()
    reads.length = 0
    expect(await partsSentUnderNonceKey(context(undefined))).toBe(0)
    expect(reads).toEqual([])
  })

  test('counts the recorded parts under the key, from any run', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a'))
    under('run-7', 2, recorded('b'))
    expect(await partsSentUnderNonceKey(context('run-7'))).toBe(2)
  })

  test('another nonceKey starts at part 1', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a'))
    expect(await partsSentUnderNonceKey(context('run-8'))).toBe(0)
  })

  test('stops at the first part with no recorded row', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a'))
    under('run-7', 3, recorded('c'))
    expect(await partsSentUnderNonceKey(context('run-7'))).toBe(1)
  })

  test('a reverted part is not counted: its key is spent and the next send says so', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a'))
    under('run-7', 2, { ...recorded('b'), status: 'reverted' })
    expect(await partsSentUnderNonceKey(context('run-7'))).toBe(1)
  })

  test('a part sent and not settled stops the try with the outcome-unknown error', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a'))
    under('run-7', 2, { ...recorded('b'), status: 'sent' })
    await expect(partsSentUnderNonceKey(context('run-7'))).rejects.toMatchObject({
      code: 'ATTESTATION_OUTCOME_UNKNOWN',
      attemptId: 'b',
      transactionHash: '0xb',
    })
  })

  test('a part claimed with no hash yet does too', async () => {
    rowsByKey = new Map()
    under('run-7', 1, { ...recorded('a'), status: 'sending', txHash: null })
    await expect(partsSentUnderNonceKey(context('run-7'))).rejects.toMatchObject({ code: 'ATTESTATION_OUTCOME_UNKNOWN' })
  })

  // Batch 18 item 30a review: a key a finished publish used isn't free for a new one
  test('another item\'s rows under the same key are not counted', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a', { seedLocalId: 'other0001' }))
    expect(await partsSentUnderNonceKey(context('run-7'))).toBe(0)
  })

  test('a key whose parts already finished a publish of the item is refused', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a'))
    under('run-7', 2, recorded('b', { requests: rootPart }))
    await expect(partsSentUnderNonceKey(context('run-7'))).rejects.toMatchObject({
      name: 'PublishNonceKeyError',
      code: 'NONCE_KEY_SPENT',
      nonceKey: 'run-7',
      message: expect.stringContaining('already finished a publish of this item'),
    })
  })
})
