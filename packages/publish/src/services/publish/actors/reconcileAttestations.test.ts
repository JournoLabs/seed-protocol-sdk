import { beforeEach, describe, expect, mock, test } from 'bun:test'

/** reconcileAttestations: what an open attempt means for a retry or a restored publish. */
const realSdk = await import('@seedprotocol/sdk')
const realChainClient = await import('../../../helpers/chainClient')
const { AttestationOutcomeUnknownError, PublishTransactionRevertedError } = await import('../../../errors')

type Row = { id: string; publishRunId: string | null; txHash: string | null; requests: string; attester: string; status: string; step?: string; nonceKey?: string; entryPoint?: string; sender?: string; fromBlock?: string }
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
const recordRelatedSeedUid = mock(async (_: unknown) => {})
mock.module('./recordMultiPublishReceipt', () => ({ recordMultiPublishReceipt, recordRelatedSeedUid }))

const recordDirectAttestation = mock(async ({ attemptId }: { attemptId: string }) => {
  Object.assign(rows.find((r) => r.id === attemptId)!, { status: 'recorded' })
  return { uids: [SEED_UID], attestationMs: 1 }
})
mock.module('./recordDirectAttestation', () => ({ recordDirectAttestation }))

let sequence: () => Promise<bigint> = async () => 0n
let userOp: () => Promise<unknown> = async () => undefined
mock.module('../../../helpers/pinnedNonce', () => ({
  readNonceSequence: () => sequence(),
  findPinnedUserOp: () => userOp(),
}))

const { reconcileAttestations } = await import('./reconcileAttestations')
const { createActor, toPromise } = await import('xstate')

const HASH = `0x${'a'.repeat(64)}`
const SEED_UID = `0x${'c'.repeat(64)}`
const ATTESTER = `0x${'b'.repeat(40)}`
const pinnedRow = (over: Partial<Row> = {}): Row =>
  row({ txHash: null, status: 'sending', nonceKey: '7', entryPoint: ATTESTER, sender: ATTESTER, fromBlock: '100', ...over })
const row = (over: Partial<Row> = {}): Row => ({
  id: 'attempt1',
  publishRunId: 'run1',
  txHash: HASH,
  requests: '[{"localId":"post"}]',
  attester: ATTESTER,
  status: 'sent',
  step: 'multiPublish',
  ...over,
})

const reasonOf = (result: unknown) => (result as { error?: { reason?: string } }).error?.reason

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
  sequence = async () => 0n
  userOp = async () => undefined
  recordMultiPublishReceipt.mockClear()
  recordDirectAttestation.mockClear()
  recordRelatedSeedUid.mockClear()
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
    expect(reasonOf(result)).toBe('chainUnreadable')
    expect(rows[0]!.status).toBe('sent')
  })

  test('no hash saved: unknown, whichever run it was', async () => {
    rows = [row({ txHash: null, status: 'sending' })]
    const result = await reconcile()
    expect(result.outcome).toBe('unknown')
    expect((result as { error: unknown }).error).toBeInstanceOf(AttestationOutcomeUnknownError)
    expect(reasonOf(result)).toBe('noEvidence')
  })
})

describe('reconcileAttestations: a direct EAS attempt', () => {
  test('landed: recorded here, then the actor sends what is left, in any run', async () => {
    rows = [row({ step: 'seed' })]
    expect(await reconcile()).toEqual({ outcome: 'send' })
    expect(recordDirectAttestation).toHaveBeenCalledTimes(1)
    expect(recordDirectAttestation.mock.calls[0]![0]).toMatchObject({
      step: 'seed',
      target: { localId: 'post' },
      attester: ATTESTER,
      attemptId: 'attempt1',
    })
    expect(recordMultiPublishReceipt).not.toHaveBeenCalled()
  })

  test('a landed seed reaches the loaded item', async () => {
    rows = [row({ step: 'seed' })]
    await reconcile()
    expect(recordRelatedSeedUid.mock.calls[0]![0]).toMatchObject({ seedLocalId: 'post', seedUid: SEED_UID })
  })

  test('a landed version or properties transaction leaves the seed alone', async () => {
    rows = [row({ step: 'version' })]
    await reconcile()
    expect(recordRelatedSeedUid).not.toHaveBeenCalled()
  })

  test('no hash and no pin: unknown', async () => {
    rows = [row({ step: 'properties', txHash: null, status: 'sending' })]
    const result = await reconcile()
    expect(result.outcome).toBe('unknown')
    expect(reasonOf(result)).toBe('noEvidence')
    expect(recordDirectAttestation).not.toHaveBeenCalled()
  })
})

describe('reconcileAttestations: an attempt with a pinned nonce and no hash', () => {
  test("not landed, this run: send again under the attempt's key", async () => {
    rows = [pinnedRow()]
    expect(await reconcile()).toEqual({ outcome: 'send', resumeAttemptId: 'attempt1' })
    expect(rows[0]!.status).toBe('sending')
  })

  test("not landed, another run: unknown, since this run's requests differ", async () => {
    rows = [pinnedRow({ publishRunId: 'run0' })]
    const result = await reconcile()
    expect(result.outcome).toBe('unknown')
    expect(reasonOf(result)).toBe('pinnedNotLanded')
  })

  test('landed: found from the logs and recorded from its receipt', async () => {
    rows = [pinnedRow()]
    sequence = async () => 1n
    userOp = async () => ({ transactionHash: HASH, success: true })
    expect(await reconcile()).toMatchObject({ outcome: 'record', unrecorded: { transactionHash: HASH } })
  })

  test('landed and failed: the attempt closes, and a new one can send', async () => {
    rows = [pinnedRow()]
    sequence = async () => 1n
    userOp = async () => ({ transactionHash: HASH, success: false })
    expect(await reconcile()).toEqual({ outcome: 'send' })
    expect(rows[0]!.status).toBe('reverted')
  })

  test('landed but not in the logs yet: unknown, never a resend', async () => {
    rows = [pinnedRow()]
    sequence = async () => 1n
    const result = await reconcile()
    expect(result.outcome).toBe('unknown')
    expect(reasonOf(result)).toBe('chainUnreadable')
  })

  test('the chain cannot be read: unknown', async () => {
    rows = [pinnedRow()]
    sequence = async () => {
      throw new Error('fetch failed')
    }
    const result = await reconcile()
    expect(result.outcome).toBe('unknown')
    expect(reasonOf(result)).toBe('chainUnreadable')
  })

  test('a named hash wins over the nonce', async () => {
    rows = [pinnedRow({ txHash: HASH, status: 'sent' })]
    sequence = async () => {
      throw new Error('not read')
    }
    expect((await reconcile()).outcome).toBe('record')
  })
})
