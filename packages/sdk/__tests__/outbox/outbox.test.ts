import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { eq, like, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState, pendingWrites } from '@/seedSchema'
import { generateId } from '@/helpers'
import {
  appendOutboxOp,
  appendOutboxOps,
  drainOutbox,
  pruneOutbox,
  OUTBOX_PRUNE_AFTER_MS,
  OUTBOX_PRUNE_FAILED_AFTER_MS,
  getOutboxOps,
  outboxOpValue,
  registerOutboxApplier,
  waitForOutboxOp,
  OutboxOpDeferredError,
  OutboxOpFailedError,
  OutboxOpRejectedError,
  OutboxOpRetryableError,
  type OutboxOp,
} from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * The outbox core (ADR 0019) with test appliers: a `set` op writes its value to appState under
 * `<seed>:<property>`, a `delete` op removes that key. What a test needs to go wrong is decided
 * per op through `behavior`.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const KEY_PREFIX = 'outbox-test:'

type Behavior = { failTimes?: number; reject?: boolean; writeThenReject?: boolean }

testDescribe('outbox', () => {
  /**
   * Ops applied, in order: `<property>=<value>` or `<property> deleted`. Includes applies a busy
   * retry rolled back; the `:applied` counter rows don't.
   */
  let applied: string[]
  /** Per seed: how to misbehave, and attempts so far. */
  let behavior: Map<string, Behavior & { attempts: number }>
  let unregister: Array<() => void>

  const stateKey = (op: OutboxOp) => `${KEY_PREFIX}${op.seedLocalId}:${op.propertyName}`
  const misbehave = async (op: OutboxOp, tx: ReturnType<typeof BaseDb.getAppDb>) => {
    const b = behavior.get(op.seedLocalId)
    if (!b) return
    b.attempts++
    if (b.writeThenReject) {
      await tx.insert(appState).values({ key: `${stateKey(op)}:partial`, value: 'partial' })
      throw new OutboxOpRejectedError('rejected after writing')
    }
    if (b.reject) throw new OutboxOpRejectedError('not allowed')
    if (b.failTimes && b.attempts <= b.failTimes) throw new OutboxOpRetryableError('transient')
  }

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  beforeEach(() => {
    applied = []
    behavior = new Map()
    pauseOutboxDrainForTests(true)
    unregister = [
      registerOutboxApplier('set', {
        apply: async (op, tx) => {
          await misbehave(op, tx)
          await tx
            .insert(appState)
            .values({ key: stateKey(op), value: outboxOpValue<string>(op) })
            .onConflictDoUpdate({ target: appState.key, set: { value: outboxOpValue<string>(op) } })
          // Counted in the transaction, so applies it rolled back (a busy retry) don't count
          await tx
            .insert(appState)
            .values({ key: `${stateKey(op)}:applied`, value: '1' })
            .onConflictDoUpdate({ target: appState.key, set: { value: sql`CAST(${appState.value} AS INTEGER) + 1` } })
          applied.push(`${op.propertyName}=${outboxOpValue(op)}`)
        },
      }),
      registerOutboxApplier('delete', {
        apply: async (op, tx) => {
          await misbehave(op, tx)
          await tx.delete(appState).where(eq(appState.key, stateKey(op)))
          applied.push(`${op.propertyName} deleted`)
        },
      }),
    ]
  })

  afterEach(async () => {
    pauseOutboxDrainForTests(true)
    await outboxIdleForTests()
    for (const off of unregister) off()
    const db = BaseDb.getAppDb()
    await db.delete(appState).where(like(appState.key, `${KEY_PREFIX}%`))
    await db.delete(pendingWrites)
  })

  afterAll(async () => {
    pauseOutboxDrainForTests(false)
    await teardownTestEnvironment()
  })

  const seed = () => generateId()
  const stored = async (seedLocalId: string, property: string) =>
    (await BaseDb.getAppDb().select().from(appState).where(eq(appState.key, `${KEY_PREFIX}${seedLocalId}:${property}`)))[0]
      ?.value
  const statuses = async (opIds: string[]) => {
    const rows = await getOutboxOps(opIds)
    return opIds.map((id) => rows.find((row) => row.opId === id)?.status)
  }

  it('applies an appended op and resolves its waiter', async () => {
    const s = seed()
    const opId = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'hello' })
    expect(await statuses([opId])).toEqual(['pending'])

    const waited = waitForOutboxOp(opId)
    await drainOutbox()
    await waited

    expect(await stored(s, 'title')).toBe('hello')
    expect(await statuses([opId])).toEqual(['applied'])
  })

  it('drains on its own in the leader tab', async () => {
    pauseOutboxDrainForTests(false)
    const s = seed()
    const opId = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'auto' })
    await waitForOutboxOp(opId)
    expect(await stored(s, 'title')).toBe('auto')
  })

  it('applies only the newest of consecutive sets and settles the older ones with it', async () => {
    const s = seed()
    const ids = []
    for (const value of ['a', 'ab', 'abc']) {
      ids.push(await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value }))
    }
    const waits = ids.map((id) => waitForOutboxOp(id))
    await drainOutbox()
    await Promise.all(waits)

    expect(applied).toEqual(['title=abc'])
    expect(await statuses(ids)).toEqual(['superseded', 'superseded', 'applied'])
    expect(await stored(s, 'title')).toBe('abc')
  })

  it('keeps a property in order and coalesces only consecutive sets', async () => {
    const s = seed()
    await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'one' })
    await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'delete' })
    await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'two' })
    await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'three' })
    await drainOutbox()

    expect(applied).toEqual(['title=one', 'title deleted', 'title=three'])
    expect(await stored(s, 'title')).toBe('three')
  })

  it('fails a rejected op without retrying, rolls back its writes, and moves on', async () => {
    const s = seed()
    behavior.set(s, { writeThenReject: true, attempts: 0 })
    const bad = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'bad' })
    const other = seed()
    const good = await appendOutboxOp({ seedLocalId: other, propertyName: 'title', kind: 'set', value: 'good' })
    const badWait = waitForOutboxOp(bad).catch((error: unknown) => error)
    await drainOutbox()

    expect(await badWait).toBeInstanceOf(OutboxOpFailedError)
    expect(behavior.get(s)!.attempts).toBe(1)
    expect(await stored(s, 'title:partial')).toBeUndefined()
    expect(await statuses([bad, good])).toEqual(['failed', 'applied'])
    const [row] = await getOutboxOps([bad])
    expect(row.error).toBe('rejected after writing')
  })

  it('a failed set fails the sets it superseded, and a later set still applies', async () => {
    const s = seed()
    behavior.set(s, { reject: true, attempts: 0 })
    const older = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'older' })
    const newer = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'newer' })
    const olderWait = waitForOutboxOp(older).catch((error: unknown) => error)
    await drainOutbox()
    expect(await olderWait).toBeInstanceOf(OutboxOpFailedError)
    expect(await statuses([older, newer])).toEqual(['superseded', 'failed'])

    behavior.delete(s)
    const later = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'later' })
    await drainOutbox()
    expect(await statuses([later])).toEqual(['applied'])
    expect(await stored(s, 'title')).toBe('later')
  })

  it('retries a transient failure with backoff, holding back the property until it applies', async () => {
    pauseOutboxDrainForTests(false)
    const s = seed()
    behavior.set(s, { failTimes: 2, attempts: 0 })
    const first = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'first' })
    const second = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'delete' })

    await waitForOutboxOp(second)
    // Two failed attempts and one that applied the set, then the delete
    expect(behavior.get(s)!.attempts).toBe(4)
    expect(applied).toEqual(['title=first', 'title deleted'])
    const [row] = await getOutboxOps([first])
    expect(row.status).toBe('applied')
    expect(row.attempts).toBe(2)
  })

  it('applies a group in one transaction, or none of it', async () => {
    const s = seed()
    const okIds = await appendOutboxOps([
      { seedLocalId: s, propertyName: 'title', kind: 'set', value: 'T' },
      { seedLocalId: s, propertyName: 'body', kind: 'set', value: 'B' },
    ])
    await drainOutbox()
    expect(await statuses(okIds)).toEqual(['applied', 'applied'])
    expect([await stored(s, 'title'), await stored(s, 'body')]).toEqual(['T', 'B'])

    const bad = seed()
    behavior.set(bad, { reject: true, attempts: 0 })
    // The second op rejects, so the first one's write is rolled back with it
    applied = []
    const badIds = await appendOutboxOps([
      { seedLocalId: seed(), propertyName: 'title', kind: 'set', value: 'kept?' },
      { seedLocalId: bad, propertyName: 'title', kind: 'set', value: 'no' },
    ])
    await drainOutbox()
    expect(await statuses(badIds)).toEqual(['failed', 'failed'])
    const firstSeed = (await getOutboxOps([badIds[0]]))[0].seedLocalId
    expect(await stored(firstSeed, 'title')).toBeUndefined()
  })

  it('two drainers at once apply each op once', async () => {
    const s = seed()
    const ids = await Promise.all(
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((p) => appendOutboxOp({ seedLocalId: s, propertyName: p, kind: 'set', value: p })),
    )
    await Promise.all([drainOutbox(), drainOutbox()])

    for (const p of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      expect(await stored(s, `${p}:applied`), p).toBe('1')
    }
    expect(await statuses(ids)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied'])
  })

  it('a waiter for an unknown op rejects', async () => {
    await expect(waitForOutboxOp('no-such-op')).rejects.toBeInstanceOf(OutboxOpFailedError)
  })

  it('an op left pending is applied when draining resumes', async () => {
    const s = seed()
    // Appended while this tab wasn't draining, as by a tab that closed or a reload
    const opId = await appendOutboxOp({ seedLocalId: s, propertyName: 'title', kind: 'set', value: 'resumed' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await statuses([opId])).toEqual(['pending'])

    pauseOutboxDrainForTests(false)
    await vi.waitFor(async () => expect(await stored(s, 'title')).toBe('resumed'), { timeout: 5000 })
  })

  it('prunes settled ops past their retention, but not pending ops or unresolved conflicts', async () => {
    const s = seed()
    const ids = await appendOutboxOps(
      ['applied', 'superseded', 'failed', 'failedRecent', 'conflict', 'resolved', 'pending', 'appliedRecent'].map(
        (name) => ({ seedLocalId: s, propertyName: name, kind: 'set' as const, value: name, groupId: generateId() }),
      ),
    )
    const [applied, superseded, failed, failedRecent, conflict, resolved, pending, appliedRecent] = ids
    const now = Date.now()
    const old = now - OUTBOX_PRUNE_AFTER_MS - 1
    const db = BaseDb.getAppDb()
    const set = (opId: string, fields: Partial<OutboxOp>) =>
      db.update(pendingWrites).set(fields).where(eq(pendingWrites.opId, opId))
    await set(applied, { status: 'applied', appliedAt: old, createdAt: old })
    await set(superseded, { status: 'superseded', createdAt: old })
    await set(failed, { status: 'failed', createdAt: now - OUTBOX_PRUNE_FAILED_AFTER_MS - 1 })
    await set(failedRecent, { status: 'failed', createdAt: old })
    await set(conflict, { status: 'applied', appliedAt: old, createdAt: old, conflict: '{}' })
    await set(resolved, { status: 'applied', appliedAt: old, createdAt: old, conflict: '{}', conflictResolvedAt: now })
    await set(pending, { createdAt: old })
    await set(appliedRecent, { status: 'applied', appliedAt: now })

    expect(await pruneOutbox(now)).toBe(4)

    const left = (await getOutboxOps(ids)).map((row) => row.opId).sort()
    expect(left).toEqual([failedRecent, conflict, pending, appliedRecent].sort())
  })

  it('an op whose lock is held is set aside without counting an attempt, and later ops apply meanwhile', async () => {
    let deferrals = 2
    unregister.push(
      registerOutboxApplier('storage', {
        around: async (_op, run) => {
          if (deferrals > 0) {
            deferrals--
            throw new OutboxOpDeferredError('locked')
          }
          return run()
        },
        apply: async (op) => {
          applied.push(`${op.propertyName}=${outboxOpValue(op)}`)
        },
      }),
    )
    const s = seed()
    const locked = await appendOutboxOp({ seedLocalId: s, propertyName: 'notes', kind: 'storage', value: 'staged' })
    const other = await appendOutboxOp({ seedLocalId: seed(), propertyName: 'title', kind: 'set', value: 'after' })

    pauseOutboxDrainForTests(false)
    await waitForOutboxOp(other)
    await waitForOutboxOp(locked)

    expect(applied).toEqual(['title=after', 'notes=staged'])
    const [row] = await getOutboxOps([locked])
    expect(row.attempts).toBe(0)
    expect(row.status).toBe('applied')
  })
})
