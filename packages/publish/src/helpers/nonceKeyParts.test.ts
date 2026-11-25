import { describe, expect, mock, test } from 'bun:test'

/**
 * Batch 18 item 30a (D68): the parts of a split publish under a host nonceKey are counted from
 * the attempt rows that sent under the part keys, whichever run sent them.
 */
const realSdk = await import('@seedprotocol/sdk')
type Row = { id: string; status: string; txHash: string | null }
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
const recorded = (id: string): Row => ({ id, status: 'recorded', txHash: `0x${id}` })
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
    under('run-7', 2, { id: 'b', status: 'reverted', txHash: '0xb' })
    expect(await partsSentUnderNonceKey(context('run-7'))).toBe(1)
  })

  test('a part sent and not settled stops the try with the outcome-unknown error', async () => {
    rowsByKey = new Map()
    under('run-7', 1, recorded('a'))
    under('run-7', 2, { id: 'b', status: 'sent', txHash: '0xb' })
    await expect(partsSentUnderNonceKey(context('run-7'))).rejects.toMatchObject({
      code: 'ATTESTATION_OUTCOME_UNKNOWN',
      attemptId: 'b',
      transactionHash: '0xb',
    })
  })

  test('a part claimed with no hash yet does too', async () => {
    rowsByKey = new Map()
    under('run-7', 1, { id: 'a', status: 'sending', txHash: null })
    await expect(partsSentUnderNonceKey(context('run-7'))).rejects.toMatchObject({ code: 'ATTESTATION_OUTCOME_UNKNOWN' })
  })
})
