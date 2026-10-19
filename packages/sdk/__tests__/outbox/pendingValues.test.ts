import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { pendingWrites } from '@/seedSchema'
import { generateId } from '@/helpers'
import { appendOutboxOp, getPendingSetValue } from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/** getPendingSetValue: an item's properties loading together share one read of its pending ops. */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

testDescribe('getPendingSetValue', () => {
  const seeds: string[] = []

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    // Ops stay pending: nothing applies them in these tests
    pauseOutboxDrainForTests(true)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    vi.restoreAllMocks()
    await outboxIdleForTests()
    const db = BaseDb.getAppDb()
    for (const seedLocalId of seeds.splice(0)) {
      await db.delete(pendingWrites).where(eq(pendingWrites.seedLocalId, seedLocalId))
    }
  })

  afterAll(async () => {
    pauseOutboxDrainForTests(false)
    await teardownTestEnvironment()
  })

  const seed = () => {
    const seedLocalId = generateId()
    seeds.push(seedLocalId)
    return seedLocalId
  }
  const set = (seedLocalId: string, propertyName: string, newValue: string | null) =>
    appendOutboxOp({ seedLocalId, propertyName, kind: 'set', value: { newValue } })

  it('answers concurrent callers for one item with one read, newest op per property', async () => {
    const seedLocalId = seed()
    await set(seedLocalId, 'title', 'first')
    await set(seedLocalId, 'title', 'second')
    await set(seedLocalId, 'summary', null)

    const selectSpy = vi.spyOn(BaseDb.getAppDb(), 'select')
    const values = await Promise.all(
      ['title', 'summary', 'url'].map((propertyName) => getPendingSetValue(seedLocalId, propertyName)),
    )

    expect(values).toEqual(['second', null, undefined])
    // Other SDK code may read meanwhile; count only selects shaped like this read
    const pendingReads = selectSpy.mock.calls.filter(([fields]) => {
      const keys = Object.keys((fields as object | undefined) ?? {}).sort()
      return keys.join(',') === 'kind,propertyName,value'
    })
    expect(pendingReads).toHaveLength(1)
  })

  it("doesn't answer a caller from a read that began before this tab appended an op", async () => {
    const seedLocalId = seed()
    await set(seedLocalId, 'title', 'before')

    // The second read is asked for while the first is still in flight; the worker runs it after
    // the append's insert, so it sees the new op.
    const earlier = getPendingSetValue(seedLocalId, 'title')
    const appending = set(seedLocalId, 'summary', 'after')
    const later = getPendingSetValue(seedLocalId, 'summary')
    await appending

    expect(await earlier).toBe('before')
    expect(await later).toBe('after')
  })

  it('reads again once the shared read has settled', async () => {
    const seedLocalId = seed()
    expect(await getPendingSetValue(seedLocalId, 'title')).toBeUndefined()
    await set(seedLocalId, 'title', 'now')
    expect(await getPendingSetValue(seedLocalId, 'title')).toBe('now')
  })
})
