import { describe, expect, mock, test } from 'bun:test'

/**
 * Batch 18 item 30a (D68): a key spent with no local row to explain it means part of a publish is
 * on chain that this database doesn't know about, and the message says so.
 */
const realSdk = await import('@seedprotocol/sdk')
const realChainClient = await import('./chainClient')
const ENTRY_POINT = `0x${'7'.repeat(40)}`
const SENDER = { address: `0x${'5'.repeat(40)}`, pinsNonceOn: ENTRY_POINT }
let chainSequence = 0n
let rows: Array<{ id: string; status: string }> = []
mock.module('@seedprotocol/sdk', () => ({ ...realSdk, findPublishAttemptsByNonceKey: async () => rows }))
mock.module('./chainClient', () => ({
  ...realChainClient,
  getPublishPublicClient: () => ({ readContract: async () => chainSequence }),
}))

const { usableHostNonceKey } = await import('./hostNonceKey')
const { publishNonceKey } = await import('./pinnedNonce')

const use = (part?: number) => usableHostNonceKey({ nonceKey: 'run-7', part, sender: SENDER, directEas: false })

describe('usableHostNonceKey', () => {
  test('an unspent key is usable', async () => {
    chainSequence = 0n
    rows = []
    expect(await use()).toBe(publishNonceKey('run-7', 1))
  })

  test('a spent key with no local row says the publish is partly on chain and where to look', async () => {
    chainSequence = 1n
    rows = []
    const error = await use().catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'PublishNonceKeyError', code: 'NONCE_KEY_SPENT', sender: SENDER.address })
    const message = (error as Error).message
    expect(message).toContain('partly on chain')
    expect(message).toContain('findPublishByNonceKey')
    expect(message).toContain('`parts`')
    expect(message).toContain('only from the database that started it')
  })

  test('says which part when it is not the first', async () => {
    chainSequence = 1n
    rows = []
    expect(((await use(2).catch((e: unknown) => e)) as Error).message).toContain('part 2')
  })

  test('a spent key a local row explains keeps the plain message', async () => {
    chainSequence = 1n
    rows = [{ id: 'a', status: 'reverted' }]
    const message = ((await use().catch((e: unknown) => e)) as Error).message
    expect(message).toContain('already landed under this nonceKey')
    expect(message).not.toContain('partly on chain')
  })
})
