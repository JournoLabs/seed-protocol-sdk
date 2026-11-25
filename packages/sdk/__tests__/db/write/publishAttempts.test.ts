import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { publishAttempts } from '@/seedSchema'
import {
  claimPublishAttempt,
  countRecordedPublishParts,
  findOpenPublishAttempts,
  findRecordedPublishParts,
  findRecordedPublishAttempts,
  updatePublishAttempt,
  type NewPublishAttempt,
  type PublishAttemptStatus,
} from '@/db/write/publishAttempts'
import { recordPublishRequests } from '@/db/write/recordPublishRequests'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const attempt = (seedLocalIds: string[], publishRunId = 'run'): NewPublishAttempt => ({
  id: generateId(),
  publishRunId,
  seedLocalId: seedLocalIds[0]!,
  seedLocalIds,
  step: 'multiPublish',
  requests: '[]',
  sender: '0x' + 'b'.repeat(40),
  attester: '0x' + 'b'.repeat(40),
  chainId: 84532,
  nonceKey: null,
  entryPoint: null,
  fromBlock: '100',
})

const statusOf = async (id: string) => {
  const [row] = await BaseDb.getAppDb().select().from(publishAttempts).where(eq(publishAttempts.id, id))
  return row?.status
}

testDescribe('publish attempts', () => {
  let seedA: string
  let seedB: string

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  beforeEach(() => {
    seedA = generateId()
    seedB = generateId()
  })

  it('commits a row in sending', async () => {
    const first = attempt([seedA])
    expect(await claimPublishAttempt(first)).toBeUndefined()
    expect(await statusOf(first.id)).toBe('sending')
  })

  it('returns the open attempt on any shared seed and commits nothing', async () => {
    const first = attempt([seedA, seedB])
    await claimPublishAttempt(first)
    const second = attempt([seedB])
    expect((await claimPublishAttempt(second))?.id).toBe(first.id)
    expect(await statusOf(second.id)).toBeUndefined()
  })

  it('ignores attempts on other seeds', async () => {
    await claimPublishAttempt(attempt([seedA]))
    expect(await claimPublishAttempt(attempt([seedB]))).toBeUndefined()
  })

  it.each<PublishAttemptStatus>(['sent', 'landed'])('%s blocks', async (status) => {
    const first = attempt([seedA])
    await claimPublishAttempt(first)
    await updatePublishAttempt(first.id, { status })
    expect((await claimPublishAttempt(attempt([seedA])))?.id).toBe(first.id)
  })

  it.each<PublishAttemptStatus>(['recorded', 'notSent', 'reverted'])('%s does not block', async (status) => {
    const first = attempt([seedA])
    await claimPublishAttempt(first)
    await updatePublishAttempt(first.id, { status })
    expect(await claimPublishAttempt(attempt([seedA]))).toBeUndefined()
  })

  it('findOpenPublishAttempts finds an attempt by any of its seeds, while it is open', async () => {
    const first = attempt([seedA, seedB])
    await claimPublishAttempt(first)
    expect((await findOpenPublishAttempts([seedB])).map((a) => a.id)).toEqual([first.id])
    await updatePublishAttempt(first.id, { status: 'abandoned' })
    expect(await findOpenPublishAttempts([seedB])).toEqual([])
  })

  it('recordPublishRequests ends the attempt, with nothing to write too', async () => {
    const first = attempt([seedA])
    await claimPublishAttempt(first)
    await recordPublishRequests([], { attemptId: first.id })
    expect(await statusOf(first.id)).toBe('recorded')
  })

  it('a failed record leaves the attempt open', async () => {
    const first = attempt([seedA])
    await claimPublishAttempt(first)
    await updatePublishAttempt(first.id, { status: 'landed' })
    const failing = {
      seed: {
        seedLocalId: seedA,
        get seedUid(): string {
          throw new Error('write failed')
        },
      },
    }
    await expect(recordPublishRequests([failing], { attemptId: first.id })).rejects.toThrow('write failed')
    expect(await statusOf(first.id)).toBe('landed')
  })
  // Batch 18 item 6 (D67): onPublished lists every part's uids, so a part keeps its own
  it('records the uids a part attested on its attempt row, and lists a run\'s parts in order', async () => {
    const run = generateId()
    const first = attempt([seedA], run)
    const second = attempt([seedB], run)
    const other = attempt([generateId()], generateId())
    for (const a of [first, second, other]) {
      await claimPublishAttempt(a)
      await updatePublishAttempt(a.id, { status: 'sent', txHash: `0x${a.id}` })
    }
    const uids = (n: string) => [`0x${n.repeat(64)}`, `0x${n.repeat(32)}${n.repeat(32)}`]
    await recordPublishRequests([], { attemptId: first.id, attestationUids: uids('1') })
    await recordPublishRequests([], { attemptId: second.id, attestationUids: uids('2') })
    await recordPublishRequests([], { attemptId: other.id, attestationUids: uids('3') })

    const parts = await findRecordedPublishParts(run)
    expect(parts.map((p) => [p.id, p.attestationUids && JSON.parse(p.attestationUids)])).toEqual([
      [first.id, uids('1')],
      [second.id, uids('2')],
    ])
  })

  it('a part recorded without uids keeps null, for a reader to fall back to its receipt', async () => {
    const run = generateId()
    const old = attempt([seedA], run)
    await claimPublishAttempt(old)
    await updatePublishAttempt(old.id, { status: 'sent', txHash: '0xabc' })
    await recordPublishRequests([], { attemptId: old.id })
    const [row] = await findRecordedPublishParts(run)
    expect(row).toMatchObject({ id: old.id, txHash: '0xabc', attestationUids: null })
  })

  it('countRecordedPublishParts counts the recorded multiPublish attempts of the given runs', async () => {
    const runA = generateId()
    const runB = generateId()
    const recorded = async (seeds: string[], run: string, step = 'multiPublish') => {
      const row = { ...attempt(seeds, run), step }
      await claimPublishAttempt(row)
      await updatePublishAttempt(row.id, { status: 'recorded' })
    }
    await recorded([seedA], runA)
    await recorded([seedB], runA)
    await recorded([generateId()], runB)
    await recorded([generateId()], runA, 'seed')
    const open = attempt([generateId()], runA)
    await claimPublishAttempt(open)
    expect(await countRecordedPublishParts([runA])).toBe(2)
    expect(await countRecordedPublishParts([runA, runB])).toBe(3)
    expect(await countRecordedPublishParts([])).toBe(0)
  })

  it('findRecordedPublishAttempts lists the recorded attempts covering the seeds, any run, any step', async () => {
    const recorded = async (seeds: string[], step: string) => {
      const row = { ...attempt(seeds, generateId()), step }
      await claimPublishAttempt(row)
      await updatePublishAttempt(row.id, { status: 'recorded' })
      return row.id
    }
    const seed = generateId()
    const seedStep = await recorded([seed], 'seed')
    const properties = await recorded([generateId(), seed], 'properties')
    await recorded([generateId()], 'properties')
    const open = attempt([seed])
    await claimPublishAttempt(open)
    await updatePublishAttempt(open.id, { status: 'sent' })
    expect((await findRecordedPublishAttempts([seed])).map((a) => a.id).sort()).toEqual([seedStep, properties].sort())
  })
})
