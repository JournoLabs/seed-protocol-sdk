import { beforeEach, describe, expect, mock, test } from 'bun:test'

/** settleAttestationAttempt: an open attempt settled from the chain with no run waiting on it. */
const realSdk = await import('@seedprotocol/sdk')
const realChainClient = await import('../../helpers/chainClient')
const { PublishTransactionRevertedError } = await import('../../errors')

type Row = {
  id: string
  publishRunId: string | null
  txHash: string | null
  requests: string
  attester: string
  status: string
  step: string
  sender: string
  nonceKey?: string
  entryPoint?: string
  fromBlock?: string
}
let rows: Row[] = []
const open = (row: Row) => ['sending', 'sent', 'landed'].includes(row.status)
const findOpenPublishAttempts = mock(async (_ids: string[]) => rows.filter(open))
const updatePublishAttempt = mock(async (id: string, update: Partial<Row>) => {
  Object.assign(rows.find((r) => r.id === id)!, update)
})
mock.module('@seedprotocol/sdk', () => ({ ...realSdk, findOpenPublishAttempts, updatePublishAttempt }))

let receipts: Record<string, () => Promise<unknown>> = {}
mock.module('../../helpers/chainClient', () => ({
  ...realChainClient,
  waitForPublishReceipt: (hash: string) => (receipts[hash] ?? (async () => ({ status: 'success' })))(),
}))

let sequence: () => Promise<bigint> = async () => 0n
mock.module('../../helpers/pinnedNonce', () => ({
  readNonceSequence: () => sequence(),
  findPinnedUserOp: async () => undefined,
}))

const recordMultiPublishReceipt = mock(async ({ attemptId }: { attemptId?: string }) => {
  Object.assign(rows.find((r) => r.id === attemptId)!, { status: 'recorded' })
  return { requests: [], attributed: [] }
})
mock.module('../publish/actors/recordMultiPublishReceipt', () => ({
  recordMultiPublishReceipt,
  recordRelatedSeedUid: async () => {},
}))

const { settleAttestationAttempt } = await import('./settleAttestationAttempt')
const { setPublishLockManagerForTests } = await import('./publishLocks')

const HASH = `0x${'a'.repeat(64)}`
const HASH2 = `0x${'d'.repeat(64)}`
const ATTESTER = `0x${'b'.repeat(40)}`
const PUBLISHER = `0x${'e'.repeat(40)}`
const row = (over: Partial<Row> = {}): Row => ({
  id: 'attempt1',
  publishRunId: 'run1',
  txHash: HASH,
  requests: '[{"localId":"post"}]',
  attester: ATTESTER,
  status: 'sent',
  step: 'multiPublish',
  sender: ATTESTER,
  ...over,
})
const noRun = () => false

let heldElsewhere: string[] = []
beforeEach(() => {
  rows = []
  receipts = {}
  sequence = async () => 0n
  heldElsewhere = []
  findOpenPublishAttempts.mockClear()
  updatePublishAttempt.mockClear()
  recordMultiPublishReceipt.mockClear()
  setPublishLockManagerForTests({
    request: (async () => undefined) as unknown as LockManager['request'],
    query: async () => ({ held: heldElsewhere.map((name) => ({ name, mode: 'exclusive' as const })), pending: [] }),
  })
})

describe('settleAttestationAttempt', () => {
  test("records another run's landed multiPublish", async () => {
    rows = [row()]
    expect(await settleAttestationAttempt('post', PUBLISHER, noRun)).toEqual({ status: 'settled' })
    expect(recordMultiPublishReceipt).toHaveBeenCalledTimes(1)
    expect(recordMultiPublishReceipt.mock.calls[0]![0]).toMatchObject({
      publisherAddress: PUBLISHER,
      attemptId: 'attempt1',
    })
  })

  test('closes an attempt whose transaction reverted', async () => {
    rows = [row()]
    receipts[HASH] = async () => {
      throw new PublishTransactionRevertedError(HASH, {})
    }
    expect(await settleAttestationAttempt('post', PUBLISHER, noRun)).toEqual({ status: 'settled' })
    expect(updatePublishAttempt.mock.calls).toEqual([['attempt1', { status: 'reverted' }]])
  })

  test('settles every open attempt in order', async () => {
    rows = [row(), row({ id: 'attempt2', txHash: HASH2 })]
    receipts[HASH] = async () => {
      throw new PublishTransactionRevertedError(HASH, {})
    }
    expect(await settleAttestationAttempt('post', PUBLISHER, noRun)).toEqual({ status: 'settled' })
    expect(rows.map((r) => r.status)).toEqual(['reverted', 'recorded'])
  })

  test('reports a pinned attempt whose key was never used, and sends nothing', async () => {
    rows = [row({ txHash: null, status: 'sending', nonceKey: '7', entryPoint: ATTESTER, fromBlock: '100' })]
    expect(await settleAttestationAttempt('post', PUBLISHER, noRun)).toEqual({
      status: 'unknown',
      reason: 'pinnedNotLanded',
      attempt: expect.objectContaining({ id: 'attempt1' }),
    })
    expect(updatePublishAttempt).not.toHaveBeenCalled()
  })

  test('refuses while this tab has a run for the seed', async () => {
    rows = [row()]
    expect(await settleAttestationAttempt('post', PUBLISHER, () => true)).toEqual({ status: 'running' })
    expect(findOpenPublishAttempts).not.toHaveBeenCalled()
  })

  test("refuses while another tab holds the seed's lock", async () => {
    rows = [row()]
    heldElsewhere = ['seed:publish:post']
    expect(await settleAttestationAttempt('post', PUBLISHER, noRun)).toEqual({ status: 'running' })
    expect(findOpenPublishAttempts).not.toHaveBeenCalled()
  })

  test('PublishManager settles only after restore, so a restored run is seen as running', async () => {
    const { PublishManager } = await import('./index')
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '20'
    const statusAtRead: string[] = []
    findOpenPublishAttempts.mockImplementation(async () => {
      statusAtRead.push(PublishManager.getRestoreStatus().outcome)
      return rows.filter(open)
    })
    try {
      rows = [row()]
      expect(await PublishManager.settleAttestationAttempt('post', PUBLISHER)).toEqual({ status: 'settled' })
      expect(statusAtRead.length).toBeGreaterThan(0)
      expect(statusAtRead).not.toContain('pending')
    } finally {
      findOpenPublishAttempts.mockImplementation(async () => rows.filter(open))
    }
  })

  test('settles where Web Locks are missing, as in Node', async () => {
    setPublishLockManagerForTests(undefined)
    rows = [row()]
    expect(await settleAttestationAttempt('post', PUBLISHER, noRun)).toEqual({ status: 'settled' })
  })
})
