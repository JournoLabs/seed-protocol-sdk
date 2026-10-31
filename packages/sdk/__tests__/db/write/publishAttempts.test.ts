import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { publishAttempts } from '@/seedSchema'
import {
  claimPublishAttempt,
  findOpenPublishAttempts,
  updatePublishAttempt,
  type NewPublishAttempt,
  type PublishAttemptStatus,
} from '@/db/write/publishAttempts'
import { recordPublishRequests } from '@/db/write/recordPublishRequests'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const attempt = (seedLocalIds: string[]): NewPublishAttempt => ({
  id: generateId(),
  publishRunId: 'run',
  seedLocalId: seedLocalIds[0]!,
  seedLocalIds,
  step: 'multiPublish',
  requests: '[]',
  sender: '0x' + 'b'.repeat(40),
  attester: '0x' + 'b'.repeat(40),
  chainId: 84532,
  nonceKey: null,
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
})
