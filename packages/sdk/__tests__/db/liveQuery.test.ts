import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { NodeDb } from '@/node/db/Db'
import { models } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { firstValueFrom, take, timeout } from 'rxjs'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'

// Node-only: BaseDb.liveQuery in Node is NodeDb's polling stub (re-runs a Drizzle query builder every second
// and emits when the rows change; SQL tag functions are rejected). The browser's reactive liveQuery is covered
// by browser/db/Db.test.ts, and Schema/Model only wire up liveQuery subscriptions in the browser, so they're
// covered by the browser Model/Item tests. This file is excluded from the browser project (`db/**`).
describe('LiveQuery (Node polling implementation)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    await cleanupTestSchemaData()
  })

  it('should return an Observable from liveQuery', () => {
    const db = BaseDb.getAppDb()
    const observable = BaseDb.liveQuery(db.select().from(models))

    expect(observable).toBeDefined()
    expect(typeof observable.subscribe).toBe('function')
  })

  it('should emit initial results immediately', async () => {
    const db = BaseDb.getAppDb()
    const [model] = await db.insert(models).values({ name: 'TestModel' }).returning()

    const observable = BaseDb.liveQuery<typeof models.$inferSelect>(
      db.select().from(models).where(eq(models.id, model.id!)),
    )
    const result = await firstValueFrom(observable.pipe(take(1), timeout({ first: 500 })))

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('TestModel')
  })

  it('should emit new results on the same subscription when data changes', async () => {
    const db = BaseDb.getAppDb()
    const [model] = await db.insert(models).values({ name: 'InitialModel' }).returning()

    const observable = BaseDb.liveQuery<typeof models.$inferSelect>(
      db.select().from(models).where(eq(models.id, model.id!)),
    )

    const emissions: string[] = []
    let notify: (() => void) | undefined
    const subscription = observable.subscribe((rows) => {
      emissions.push(rows[0]?.name ?? '<none>')
      notify?.()
    })
    const nextEmission = (count: number, ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (emissions.length >= count) return resolve()
        const timer = setTimeout(() => reject(new Error(`no emission #${count} within ${ms}ms`)), ms)
        notify = () => {
          if (emissions.length >= count) {
            clearTimeout(timer)
            resolve()
          }
        }
      })

    try {
      await nextEmission(1, 1000)
      expect(emissions).toEqual(['InitialModel'])

      await db.update(models).set({ name: 'UpdatedModel' }).where(eq(models.id, model.id!))

      // Polls every second
      await nextEmission(2, 3000)
      expect(emissions).toEqual(['InitialModel', 'UpdatedModel'])
    } finally {
      subscription.unsubscribe()
    }
  }, 10000)

  it('should not re-emit when the rows are unchanged', async () => {
    const db = BaseDb.getAppDb()
    const [model] = await db.insert(models).values({ name: 'StableModel' }).returning()

    const observable = BaseDb.liveQuery<typeof models.$inferSelect>(
      db.select().from(models).where(eq(models.id, model.id!)),
    )
    let emissionCount = 0
    const subscription = observable.subscribe(() => {
      emissionCount++
    })
    try {
      // Long enough for at least two polls after the initial query
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(emissionCount).toBe(1)
    } finally {
      subscription.unsubscribe()
    }
  }, 10000)

  it('should reject SQL tag function queries (not supported by the Node stub)', () => {
    expect(() =>
      BaseDb.liveQuery((sql: any) => sql`SELECT * FROM models`),
    ).toThrow('SQL tag functions are not supported in node liveQuery')
  })

  it('should throw if the database has not been prepared', () => {
    const unpreparedDb = new NodeDb()
    expect(() => unpreparedDb.liveQuery(BaseDb.getAppDb().select().from(models))).toThrow(
      'Database not initialized',
    )
  })
})
