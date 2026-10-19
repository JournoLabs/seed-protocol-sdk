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
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import debug from 'debug'
import { sql } from 'drizzle-orm'
import { BaseEasClient, resetSchemaUidCaches } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { createNewItem } from '@/db/write/createNewItem'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { dbTimingCounters } from '@/helpers/timing'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle, type HasService } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
const enabled = Boolean(env.SEED_BENCH)
const itemCount = Number(env.SEED_BENCH_ITEMS || 40)
const easDelayMs = Number(env.SEED_BENCH_EAS_MS || 0)
// The browser build of `debug` reads only localStorage, not the DEBUG the config passes in.
if (enabled && env.DEBUG) debug.enable(env.DEBUG)

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

/** Round trip of a trivial statement: how long the SQLite worker's queue is right now. */
const probeQueue = () => time(() => BaseDb.getAppDb()!.all(sql`SELECT 1`))

/**
 * Waits until the live-query re-runs a write started are done. SQLocal announces written tables
 * after a 32 ms debounce (180 ms at most), so an empty queue right after a write means nothing:
 * wait past that window first, then until a trivial statement comes back within `quietMs`.
 */
const waitForQuietQueue = async (quietMs = 5, timeoutMs = 10_000) => {
  const start = performance.now()
  await new Promise((resolve) => setTimeout(resolve, 250))
  while (performance.now() - start < timeoutMs) {
    if ((await probeQueue()) < quietMs) return performance.now() - start
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return performance.now() - start
}

const time = async (fn: () => Promise<unknown>) => {
  const start = performance.now()
  await fn()
  return performance.now() - start
}

describe.skipIf(!enabled)('item latency bench', () => {
  const loaded: Item<any>[] = []
  let restoreEasClient: (() => void) | undefined

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
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    for (const item of loaded) item.unload()
    restoreEasClient?.()
    resetSchemaUidCaches()
    await teardownTestEnvironment()
  })

  const report = (phase: string, ms: number[]) => {
    console.log(JSON.stringify({ bench: 'itemLatency', phase, loadedItems: loaded.length, easDelayMs, ...stats(ms) }))
  }

  const measure = async (when: string) => {
    const creates: number[] = []
    for (let i = 0; i < 5; i++) {
      creates.push(await time(() => createNewItem({ modelName: 'BenchClip', schemaName, ...values(i) } as never)))
    }
    report(`${when}: createNewItem`, creates)

    if (loaded.length === 0) return

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

    // Right after a create, as before; then again once the worker has drained the re-runs the
    // create's writes started, so the difference is time spent queued behind them.
    for (const drained of [false, true]) {
      const coldFinds: number[] = []
      const probes: number[] = []
      const drainWaits: number[] = []
      const waveRuns: number[] = []
      for (let i = 0; i < 5; i++) {
        const runsBefore = dbTimingCounters.liveQueryRuns
        const created = await createNewItem({ modelName: 'BenchClip', schemaName, ...values(1000 + i) } as never)
        if (drained) {
          drainWaits.push(await waitForQuietQueue())
          // Counted only under DEBUG=seedSdk:timing.
          waveRuns.push(dbTimingCounters.liveQueryRuns - runsBefore)
        }
        probes.push(await probeQueue())
        let found: Item<any> | undefined
        coldFinds.push(
          await time(async () => {
            found = (await Item.find({ modelName: 'BenchClip', seedLocalId: created.seedLocalId })) as Item<any>
          }),
        )
        expect(found).toBeDefined()
        found?.unload()
      }
      const suffix = drained ? ', queue drained first' : ''
      if (drained) {
        report(`${when}: wait for quiet queue after create`, drainWaits)
        report(`${when}: live-query runs one create started`, waveRuns)
      }
      report(`${when}: SELECT 1 before find${suffix}`, probes)
      report(`${when}: Item.find (not cached${suffix})`, coldFinds)
    }
  }

  it(
    'times creates, saves and finds before and after loading items',
    async () => {
      await measure('empty')

      const loadStart = performance.now()
      const loads: number[] = []
      for (let i = 0; i < itemCount; i++) {
        loads.push(
          await time(async () => {
            const item = await Item.create({ modelName: 'BenchClip', schemaName, ...values(i) })
            await waitForIdle(item as unknown as HasService, 'Item', 30_000)
            loaded.push(item as Item<any>)
          }),
        )
      }
      report('load: Item.create + waitForIdle, first half', loads.slice(0, Math.ceil(itemCount / 2)))
      report('load: Item.create + waitForIdle, second half', loads.slice(Math.ceil(itemCount / 2)))
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
