import { beforeEach, describe, expect, mock, test } from 'bun:test'

/** reconcileAttestations: what an open attempt means for a retry or a restored publish. */
const realSdk = await import('@seedprotocol/sdk')
const realChainClient = await import('../../../helpers/chainClient')
const { AttestationOutcomeUnknownError, PublishTransactionRevertedError } = await import('../../../errors')

type Row = { id: string; publishRunId: string | null; txHash: string | null; requests: string; attester: string; status: string }
let rows: Row[] = []
const open = (row: Row) => ['sending', 'sent', 'landed'].includes(row.status)
const updatePublishAttempt = mock(async (id: string, update: Partial<Row>) => {
  Object.assign(rows.find((r) => r.id === id)!, update)
})

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async () => rows.filter(open),
  updatePublishAttempt,
}))

let receipt: () => Promise<unknown> = async () => ({ status: 'success' })
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  waitForPublishReceipt: () => receipt(),
}))

const recordMultiPublishReceipt = mock(async ({ attemptId }: { attemptId?: string }) => {
  Object.assign(rows.find((r) => r.id === attemptId)!, { status: 'recorded' })
  return { requests: [], attributed: [] }
})
mock.module('./recordMultiPublishReceipt', () => ({ recordMultiPublishReceipt }))

const { reconcileAttestations } = await import('./reconcileAttestations')
const { createActor, toPromise } = await import('xstate')

const HASH = `0x${'a'.repeat(64)}`
const ATTESTER = `0x${'b'.repeat(40)}`
const row = (over: Partial<Row> = {}): Row => ({
  id: 'attempt1',
  publishRunId: 'run1',
  txHash: HASH,
  requests: '[{"localId":"post"}]',
  attester: ATTESTER,
  status: 'sent',
  ...over,
})

const reconcile = (context: Record<string, unknown> = {}) => {
  const actor = createActor(reconcileAttestations, {
    input: {
      context: { item: { seedLocalId: 'post' }, address: ATTESTER, publishRunId: 'run1', ...context } as any,
    },
  })
  actor.start()
  return toPromise(actor)
}

beforeEach(() => {
  rows = []
  receipt = async () => ({ status: 'success' })
  recordMultiPublishReceipt.mockClear()
})

describe('reconcileAttestations', () => {
  test('no open attempt: send', async () => {
    expect(await reconcile()).toEqual({ outcome: 'send' })
  })

  test("this run's landed transaction: record it, from the requests that were sent", async () => {
    rows = [row()]
    expect(await reconcile()).toEqual({
      outcome: 'record',
      unrecorded: { attemptId: 'attempt1', transactionHash: HASH, requests: [{ localId: 'post' }], attester: ATTESTER } as any,
    })
    expect(recordMultiPublishReceipt).not.toHaveBeenCalled()
  })

  test("another run's landed transaction: recorded here, then this run sends what is left", async () => {
    rows = [row({ publishRunId: 'run0' })]
    expect(await reconcile()).toEqual({ outcome: 'send' })
    expect(recordMultiPublishReceipt).toHaveBeenCalledTimes(1)
    expect(rows[0]!.status).toBe('recorded')
  })

  test('a reverted transaction: the attempt closes and nothing blocks the send', async () => {
    rows = [row()]
    receipt = async () => {
      throw new PublishTransactionRevertedError(HASH, {})
    }
    expect(await reconcile()).toEqual({ outcome: 'send' })
    expect(rows[0]!.status).toBe('reverted')
  })

  test('no receipt: unknown, and the attempt stays open', async () => {
    rows = [row()]
    receipt = async () => {
      throw new Error('Timed out while waiting for transaction')
    }
    const result = await reconcile()
    expect(result.outcome).toBe('unknown')
    expect(rows[0]!.status).toBe('sent')
  })

  test('no hash saved: unknown, whichever run it was', async () => {
    rows = [row({ txHash: null, status: 'sending' })]
    const result = await reconcile()
    expect(result.outcome).toBe('unknown')
    expect((result as { error: unknown }).error).toBeInstanceOf(AttestationOutcomeUnknownError)
  })
})
