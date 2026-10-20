/**
 * Latency bench for item creates, property saves and finds with many items loaded, which is when
 * PermaPress measured seconds per call. Skipped unless SEED_BENCH is set:
 *
 *   SEED_BENCH=1 npx vitest run packages/sdk/__tests__/bench --project browser --silent=false --reporter=verbose
 *
 * SEED_BENCH_ITEMS (default 40) items of 8 properties stay loaded, so their live queries are open,
 * as on an edit page. The EAS indexer is a stub that answers "no schema" after
 * SEED_BENCH_EAS_MS (default 0). Results print as one JSON line per phase. Add
 * DEBUG=seedSdk:timing for per-phase lines from the SDK.
 *
 * The `re-runs after` phases count statements the SQLite worker ran from the start of a write until
 * 600 ms after it returned (SQLocal debounces table changes 32 ms, 180 ms at most): `sqlTag` counts
 * SQL-tag statements (liveQueries, the change feed's query and its entity reads; the write itself
 * uses none), `all` every statement, the write's own included.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { BaseEasClient, resetSchemaUidCaches } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { createNewItem } from '@/db/write/createNewItem'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle, type HasService } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
const enabled = Boolean(env.SEED_BENCH)
const itemCount = Number(env.SEED_BENCH_ITEMS || 40)
const easDelayMs = Number(env.SEED_BENCH_EAS_MS || 0)

const schemaName = 'Bench Item Latency'
const testSchema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'bench-item-latency',
  metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    BenchClip: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        summary: { id: generateId(), type: 'Text' },
        url: { id: generateId(), type: 'Text' },
        kind: { id: generateId(), type: 'Text' },
        width: { id: generateId(), type: 'Number' },
        height: { id: generateId(), type: 'Number' },
        savedAt: { id: generateId(), type: 'Date' },
        datePublished: { id: generateId(), type: 'Date' },
      },
    },
  },
  enums: {},
  migrations: [],
}

const values = (n: number) => ({
  title: `Clip ${n}`,
  summary: `Summary ${n}`,
  url: `https://example.com/${n}`,
  kind: 'page',
  width: 640,
  height: 480,
  savedAt: '2026-10-18',
  datePublished: '2024-11-20',
})

const stats = (ms: number[]) => {
  const sorted = [...ms].sort((a, b) => a - b)
  const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!)
  return { n: ms.length, median: at(0.5), p90: at(0.9), max: Math.round(sorted[sorted.length - 1]!) }
}

const time = async (fn: () => Promise<unknown>) => {
  const start = performance.now()
  await fn()
  return performance.now() - start
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!enabled)('item latency bench', () => {
  const loaded: Item<any>[] = []
  let restoreEasClient: (() => void) | undefined
  let restoreCounters: (() => void) | undefined
  const statements = { sqlTag: 0, all: 0 }

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
    const model = Model.create('BenchClip', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

    const online = BaseEasClient.getEasClient()
    BaseEasClient.configure({
      getEasClient: () =>
        ({
          request: async () => {
            if (easDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, easDelayMs))
            return { schemas: [] }
          },
        }) as never,
    })
    restoreEasClient = () => BaseEasClient.configure({ getEasClient: () => online })
    resetSchemaUidCaches()

    // sql() takes SQL-tag statements; exec() takes every statement, sql()'s included.
    const instance = (BaseDb as any)._impl.sqlocalInstance
    const { sql: originalSql, exec: originalExec } = instance
    instance.sql = (...args: any[]) => {
      statements.sqlTag++
      return originalSql(...args)
    }
    instance.exec = (...args: any[]) => {
      statements.all++
      return originalExec(...args)
    }
    restoreCounters = () => {
      instance.sql = originalSql
      instance.exec = originalExec
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    for (const item of loaded) item.unload()
    restoreCounters?.()
    restoreEasClient?.()
    resetSchemaUidCaches()
    await teardownTestEnvironment()
  })

  const report = (phase: string, ms: number[]) => {
    console.log(JSON.stringify({ bench: 'itemLatency', phase, loadedItems: loaded.length, easDelayMs, ...stats(ms) }))
  }

  /**
   * Statements run from the start of `write` until 600 ms after it returns, once the previous
   * write's have drained. A save waits for its op to apply, so its re-runs can start before it returns.
   */
  const reRuns = async (write: () => Promise<unknown>) => {
    await sleep(400)
    const before = { ...statements }
    await write()
    await sleep(600)
    return { sqlTag: statements.sqlTag - before.sqlTag, all: statements.all - before.all }
  }

  const reportReRuns = (phase: string, runs: { sqlTag: number; all: number }[]) => {
    console.log(
      JSON.stringify({
        bench: 'itemLatency',
        phase,
        loadedItems: loaded.length,
        sqlTag: stats(runs.map((r) => r.sqlTag)),
        all: stats(runs.map((r) => r.all)),
      }),
    )
  }

  const measure = async (when: string) => {
    const createRuns = []
    for (let i = 0; i < 5; i++) {
      createRuns.push(await reRuns(() => createNewItem({ modelName: 'BenchClip', schemaName, ...values(500 + i) } as never)))
    }
    reportReRuns(`${when}: re-runs after createNewItem`, createRuns)

    const creates: number[] = []
    for (let i = 0; i < 5; i++) {
      creates.push(await time(() => createNewItem({ modelName: 'BenchClip', schemaName, ...values(i) } as never)))
    }
    report(`${when}: createNewItem`, creates)

    if (loaded.length === 0) return

    const saveRuns = []
    for (let i = 0; i < 5; i++) {
      const property = loaded[i]!.properties.find((p) => p.propertyName === 'title') as ItemProperty<any>
      // The assignment appends the write; save() waits for it.
      saveRuns.push(
        await reRuns(() => {
          property.value = `rerun ${i}`
          return property.save()
        }),
      )
    }
    reportReRuns(`${when}: re-runs after property.save`, saveRuns)

    const saves: number[] = []
    const names = ['title', 'width', 'savedAt', 'summary'] as const
    for (let i = 0; i < 20; i++) {
      const item = loaded[i % loaded.length]!
      const name = names[i % names.length]!
      const property = item.properties.find((p) => p.propertyName === name) as ItemProperty<any>
      property.value = name === 'width' ? 700 + i : name === 'savedAt' ? `2026-10-${10 + (i % 9)}` : `${name} ${i}`
      saves.push(await time(() => property.save()))
    }
    report(`${when}: property.save`, saves)

    const cachedFinds: number[] = []
    for (let i = 0; i < 5; i++) {
      const item = loaded[i]!
      cachedFinds.push(await time(() => Item.find({ modelName: 'BenchClip', seedLocalId: item.seedLocalId })))
    }
    report(`${when}: Item.find (cached)`, cachedFinds)

    const coldFinds: number[] = []
    for (let i = 0; i < 5; i++) {
      const created = await createNewItem({ modelName: 'BenchClip', schemaName, ...values(1000 + i) } as never)
      let found: Item<any> | undefined
      coldFinds.push(
        await time(async () => {
          found = (await Item.find({ modelName: 'BenchClip', seedLocalId: created.seedLocalId })) as Item<any>
        }),
      )
      expect(found).toBeDefined()
      found?.unload()
    }
    report(`${when}: Item.find (not cached)`, coldFinds)

    // The same once the create's re-runs have drained, for comparison.
    const drainedFinds: number[] = []
    for (let i = 0; i < 5; i++) {
      const created = await createNewItem({ modelName: 'BenchClip', schemaName, ...values(2000 + i) } as never)
      await sleep(1000)
      let found: Item<any> | undefined
      drainedFinds.push(
        await time(async () => {
          found = (await Item.find({ modelName: 'BenchClip', seedLocalId: created.seedLocalId })) as Item<any>
        }),
      )
      found?.unload()
    }
    report(`${when}: Item.find (not cached, after 1 s)`, drainedFinds)
  }

  it(
    'times creates, saves and finds before and after loading items',
    async () => {
      await measure('empty')

      const loadStart = performance.now()
      const loads: number[] = []
      for (let i = 0; i < itemCount; i++) {
        let item: Item<any> | undefined
        loads.push(
          await time(async () => {
            item = (await Item.create({ modelName: 'BenchClip', schemaName, ...values(i) })) as Item<any>
            await waitForIdle(item as unknown as HasService, 'Item', 30_000)
          }),
        )
        loaded.push(item!)
      }
      const half = Math.floor(loads.length / 2)
      report(`Item.create + waitForIdle, items 1-${half}`, loads.slice(0, half))
      report(`Item.create + waitForIdle, items ${half + 1}-${loads.length}`, loads.slice(half))
      console.log(
        JSON.stringify({
          bench: 'itemLatency',
          phase: 'load items',
          loadedItems: loaded.length,
          totalMs: Math.round(performance.now() - loadStart),
        }),
      )

      await measure('loaded')
    },
    30 * 60_000,
  )
})
