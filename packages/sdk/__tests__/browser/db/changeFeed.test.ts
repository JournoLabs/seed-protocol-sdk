import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { BaseEasClient, resetSchemaUidCaches } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { entityChanges, metadata, seeds } from '@/seedSchema'
import { createNewItem } from '@/db/write/createNewItem'
import { ENTITY_CHANGES_RETENTION_MS } from '@/db/entityChangesPrune'
import {
  resetChangeFeedForTests,
  watchEntityChanges,
  watchEntityRows,
  type ChangeWatch,
} from '@/browser/db/changeFeed'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

/**
 * The tab's change feed (ADR 0020): dispatch by seed local id, uid and property name, one call
 * per log read, newer reads winning, a missed stretch of the log, and leader pruning. The
 * cross-tab path is in browser/multiTab.e2e.test.ts. Browser only: Node has no change feed.
 */

const SCHEMA_NAME = 'Test Schema Change Feed'
const MODEL = 'FeedPost'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      [MODEL]: {
        id: generateId(),
        properties: { title: { id: generateId(), type: 'Text' }, summary: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const db = () => BaseDb.getAppDb()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Longer than SQLocal's effects debounce (32 ms, 180 ms at most) plus the log read. */
const SETTLE_MS = 400

const insertSeed = async (uid?: string) => {
  const localId = generateId()
  await db().insert(seeds).values({ localId, uid, type: 'feed_post', createdAt: Date.now() })
  return localId
}
const touchSeed = (localId: string) =>
  db().update(seeds).set({ updatedAt: Date.now() }).where(eq(seeds.localId, localId))

describe.skipIf(typeof window === 'undefined').sequential('change feed', () => {
  let restoreEasClient: (() => void) | undefined
  const unwatch: Array<() => void> = []

  const watch = (w: ChangeWatch) => {
    const listener = vi.fn()
    unwatch.push(watchEntityChanges(w, listener))
    return listener
  }

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const online = BaseEasClient.getEasClient()
    BaseEasClient.configure({ getEasClient: () => ({ request: async () => ({ schemas: [] }) }) as never })
    restoreEasClient = () => BaseEasClient.configure({ getEasClient: () => online })
    resetSchemaUidCaches()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    for (const fn of unwatch.splice(0)) fn()
  })

  afterAll(async () => {
    restoreEasClient?.()
    resetSchemaUidCaches()
    await teardownTestEnvironment()
  })

  it("calls a seed's watchers once per write, by local id or uid, and no one else's", async () => {
    const uid = `0x${'Ab'.repeat(32)}`
    const watched = await insertSeed(uid)
    const other = await insertSeed()
    await sleep(SETTLE_MS)
    const byLocalId = watch({ seedLocalId: watched, tables: ['seeds'] })
    const byUid = watch({ seedUid: uid.toLowerCase(), tables: ['seeds'] })
    const versionsOnly = watch({ seedLocalId: watched, tables: ['versions'] })
    const otherSeed = watch({ seedLocalId: other, tables: ['seeds'] })

    await touchSeed(watched)
    await vi.waitFor(() => expect(byLocalId).toHaveBeenCalledTimes(1), { timeout: WAIT_TIMEOUT_MS })
    await vi.waitFor(() => expect(byUid).toHaveBeenCalledTimes(1), { timeout: WAIT_TIMEOUT_MS })
    await sleep(SETTLE_MS)
    expect(versionsOnly).not.toHaveBeenCalled()
    expect(otherSeed).not.toHaveBeenCalled()
  })

  it('calls a watcher once for a create that logs many rows', async () => {
    const { seedLocalId } = await createNewItem({ modelName: MODEL, title: 't', summary: 's' } as never)
    const logged = await db().select().from(entityChanges).where(eq(entityChanges.seedLocalId, seedLocalId))
    expect(logged.length).toBeGreaterThan(3)
    await sleep(SETTLE_MS)

    const listener = watch({ seedLocalId, tables: ['seeds', 'versions', 'metadata'] })
    await BaseDb.transaction(async (tx) => {
      await tx.update(seeds).set({ updatedAt: Date.now() }).where(eq(seeds.localId, seedLocalId))
      await tx.update(metadata).set({ updatedAt: Date.now() }).where(eq(metadata.seedLocalId, seedLocalId))
    })
    await vi.waitFor(() => expect(listener).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT_MS })
    await sleep(SETTLE_MS)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('filters metadata rows by property name', async () => {
    const { seedLocalId } = await createNewItem({ modelName: MODEL, title: 't', summary: 's' } as never)
    await sleep(SETTLE_MS)
    const title = watch({ seedLocalId, tables: ['metadata'], propertyNames: ['title'] })
    const summary = watch({ seedLocalId, tables: ['metadata'], propertyNames: ['summary'] })

    await db()
      .update(metadata)
      .set({ propertyValue: 'edited' })
      .where(sql`${metadata.seedLocalId} = ${seedLocalId} AND ${metadata.propertyName} = 'summary'`)
    await vi.waitFor(() => expect(summary).toHaveBeenCalledTimes(1), { timeout: WAIT_TIMEOUT_MS })
    await sleep(SETTLE_MS)
    expect(title).not.toHaveBeenCalled()
  })

  it('drops a read that finishes after a newer one', async () => {
    const localId = await insertSeed()
    await sleep(SETTLE_MS)
    const resolvers: Array<(value: number) => void> = []
    const results: number[] = []
    const subscription = watchEntityRows(
      { seedLocalId: localId, tables: ['seeds'] },
      () => new Promise<number>((resolve) => resolvers.push(resolve)),
      (value) => results.push(value),
    )
    unwatch.push(() => subscription.unsubscribe())

    await touchSeed(localId)
    await vi.waitFor(() => expect(resolvers).toHaveLength(1), { timeout: WAIT_TIMEOUT_MS })
    await touchSeed(localId)
    await vi.waitFor(() => expect(resolvers).toHaveLength(2), { timeout: WAIT_TIMEOUT_MS })

    resolvers[1]!(2)
    resolvers[0]!(1)
    await sleep(10)
    expect(results).toEqual([2])
  })

  it('calls every watcher when log rows it had not read were pruned', async () => {
    const a = await insertSeed()
    const b = await insertSeed()
    await sleep(SETTLE_MS)
    const unrelated = watch({ seedLocalId: generateId(), tables: ['metadata'] })

    // A tab that slept through pruning: the first row after its cursor is gone.
    await BaseDb.transaction(async (tx) => {
      await tx.update(seeds).set({ updatedAt: Date.now() }).where(eq(seeds.localId, a))
      await tx.run(sql`DELETE FROM entity_changes WHERE seq = (SELECT max(seq) FROM entity_changes)`)
      await tx.update(seeds).set({ updatedAt: Date.now() }).where(eq(seeds.localId, b))
    })
    await vi.waitFor(() => expect(unrelated).toHaveBeenCalledTimes(1), { timeout: WAIT_TIMEOUT_MS })
  })

  it('prunes rows older than the retention, at most once a minute', async () => {
    const localId = await insertSeed()
    await sleep(SETTLE_MS)
    const insertOld = async () => {
      await db()
        .insert(entityChanges)
        .values({ tbl: 'seeds', seedLocalId: 'old', at: Date.now() - ENTITY_CHANGES_RETENTION_MS - 1000 })
      const [row] = await db().select({ seq: sql<number>`max(seq)` }).from(entityChanges)
      return Number(row!.seq)
    }
    const exists = async (seq: number) =>
      (await db().select().from(entityChanges).where(eq(entityChanges.seq, seq))).length > 0

    resetChangeFeedForTests()
    const first = await insertOld()
    await vi.waitFor(async () => expect(await exists(first)).toBe(false), { timeout: WAIT_TIMEOUT_MS })
    expect(await db().select().from(entityChanges).where(eq(entityChanges.seedLocalId, localId))).not.toHaveLength(0)

    const second = await insertOld()
    await touchSeed(localId)
    await sleep(SETTLE_MS)
    expect(await exists(second)).toBe(true)
  })
})
