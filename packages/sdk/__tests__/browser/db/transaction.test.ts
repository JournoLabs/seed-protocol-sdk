import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState, models, properties } from '@/seedSchema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

/**
 * BaseDb.transaction: SQLocal's transaction in the browser, libsql's in Node. The callback runs
 * Drizzle queries on the `tx` it gets, and they commit together or not at all.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const KEY_PREFIX = 'tx-test-'

testDescribe('BaseDb.transaction', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    await BaseDb.getAppDb().delete(appState).where(like(appState.key, `${KEY_PREFIX}%`))
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const key = () => `${KEY_PREFIX}${generateId()}`
  const readValue = async (k: string) =>
    (await BaseDb.getAppDb().select().from(appState).where(eq(appState.key, k)))[0]?.value

  it('commits every statement', async () => {
    const [a, b] = [key(), key()]
    const result = await BaseDb.transaction(async (tx) => {
      await tx.insert(appState).values({ key: a, value: 'one' })
      await tx.insert(appState).values({ key: b, value: 'two' })
      return 'done'
    })

    expect(result).toBe('done')
    expect(await readValue(a)).toBe('one')
    expect(await readValue(b)).toBe('two')
  })

  it('rolls everything back when the callback throws', async () => {
    const [a, b] = [key(), key()]
    await expect(
      BaseDb.transaction(async (tx) => {
        await tx.insert(appState).values({ key: a, value: 'one' })
        await tx.update(appState).set({ value: 'changed' }).where(eq(appState.key, a))
        await tx.insert(appState).values({ key: b, value: 'two' })
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')

    expect(await readValue(a)).toBeUndefined()
    expect(await readValue(b)).toBeUndefined()
  })

  it('reads its own writes, with Drizzle field names, joins and returning()', async () => {
    const a = key()
    const { inserted, read, joined } = await BaseDb.transaction(async (tx) => {
      const inserted = await tx.insert(appState).values({ key: a, value: 'mine' }).returning()
      const read = await tx.select().from(appState).where(eq(appState.key, a))
      // Two columns named `name`: kept apart by Drizzle, not merged by name
      const joined = await tx
        .select({ propertyName: properties.name, modelName: models.name })
        .from(properties)
        .innerJoin(models, eq(properties.modelId, models.id))
        .limit(1)
      return { inserted, read, joined }
    })

    expect(inserted[0]).toMatchObject({ key: a, value: 'mine' })
    expect(read).toEqual([expect.objectContaining({ key: a, value: 'mine' })])
    for (const row of joined) {
      expect(Object.keys(row).sort()).toEqual(['modelName', 'propertyName'])
    }
  })

  it("other queries don't see uncommitted rows", async () => {
    const a = key()
    let inserted!: () => void
    const insertDone = new Promise<void>((resolve) => (inserted = resolve))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))

    const running = BaseDb.transaction(async (tx) => {
      await tx.insert(appState).values({ key: a, value: 'uncommitted' })
      inserted()
      await gate
      throw new Error('roll back')
    })
    await insertDone
    // While the transaction is open: either waits for it to end (browser) or reads committed rows
    const outside = readValue(a)
    await new Promise((resolve) => setTimeout(resolve, 50))
    release()
    await expect(running).rejects.toThrow('roll back')

    expect(await outside).toBeUndefined()
    expect(await readValue(a)).toBeUndefined()
  })
})
