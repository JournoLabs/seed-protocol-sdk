/**
 * Write cost of the entity_changes triggers (ADR 0020, migration 0022): createNewItem and
 * property.save with one item loaded, with the triggers dropped and with them in place, in
 * alternating rounds so drift on a busy machine hits both. Skipped unless SEED_BENCH is set:
 *
 *   SEED_BENCH=1 npx vitest run packages/sdk/__tests__/bench/entityChangesWriteCost.test.ts --project browser --silent=false --reporter=verbose
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { BaseEasClient, resetSchemaUidCaches } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { migrationSql_0022_add_entity_changes } from '@/browser/db/drizzleFiles'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { createNewItem } from '@/db/write/createNewItem'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle, type HasService } from '../test-utils/waitForIdle'

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
const enabled = Boolean(env.SEED_BENCH)
const ROUNDS = 4
const PER_ROUND = 10

const schemaName = 'Bench Entity Changes Write Cost'
const props = ['title', 'summary', 'url', 'kind', 'width', 'height', 'savedAt', 'datePublished']
const testSchema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'bench-entity-changes-write-cost',
  metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    CostClip: {
      id: generateId(),
      properties: Object.fromEntries(props.map((p) => [p, { id: generateId(), type: 'Text' }])),
    },
  },
  enums: {},
  migrations: [],
}
const values = (n: number) => Object.fromEntries(props.map((p) => [p, `${p} ${n}`]))

const triggerStatements = migrationSql_0022_add_entity_changes
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.startsWith('CREATE TRIGGER'))
const triggerNames = triggerStatements.map((s) => s.match(/CREATE TRIGGER `([^`]+)`/)![1]!)

const median = (ms: number[]) => {
  const sorted = [...ms].sort((a, b) => a - b)
  return Math.round(sorted[Math.floor(sorted.length / 2)]! * 10) / 10
}
const time = async (fn: () => Promise<unknown>) => {
  const start = performance.now()
  await fn()
  return performance.now() - start
}

describe.skipIf(!enabled)('entity_changes trigger write cost', () => {
  let restoreEasClient: (() => void) | undefined
  let item: Item<any>

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
    const online = BaseEasClient.getEasClient()
    BaseEasClient.configure({ getEasClient: () => ({ request: async () => ({ schemas: [] }) }) as never })
    restoreEasClient = () => BaseEasClient.configure({ getEasClient: () => online })
    resetSchemaUidCaches()
    item = (await Item.create({ modelName: 'CostClip', schemaName, ...values(0) } as never)) as Item<any>
    await waitForIdle(item as unknown as HasService, 'Item', 30_000)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    item?.unload()
    restoreEasClient?.()
    resetSchemaUidCaches()
    await teardownTestEnvironment()
  })

  const setTriggers = async (on: boolean) => {
    const db = BaseDb.getAppDb()
    for (const name of triggerNames) await db.run(sql.raw(`DROP TRIGGER IF EXISTS \`${name}\``))
    if (on) for (const statement of triggerStatements) await db.run(sql.raw(statement))
  }

  it('times writes with and without the triggers', async () => {
    expect(triggerStatements).toHaveLength(9)
    const results = { off: { create: [] as number[], save: [] as number[] }, on: { create: [] as number[], save: [] as number[] } }
    const title = item.properties.find((p) => p.propertyName === 'title') as ItemProperty<any>
    let n = 0
    for (let round = 0; round < ROUNDS; round++) {
      const modes: Array<'off' | 'on'> = round % 2 === 0 ? ['off', 'on'] : ['on', 'off']
      for (const mode of modes) {
        await setTriggers(mode === 'on')
        // Let the previous writes' live-query wave drain.
        await new Promise((resolve) => setTimeout(resolve, 400))
        for (let i = 0; i < PER_ROUND; i++) {
          results[mode].create.push(await time(() => createNewItem({ modelName: 'CostClip', schemaName, ...values(++n) } as never)))
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
        for (let i = 0; i < PER_ROUND; i++) {
          title.value = `title ${++n}`
          results[mode].save.push(await time(() => title.save()))
        }
      }
    }
    await setTriggers(true)
    console.log(
      JSON.stringify({
        bench: 'entityChangesWriteCost',
        createNewItem: { off: median(results.off.create), on: median(results.on.create), n: results.on.create.length },
        propertySave: { off: median(results.off.save), on: median(results.on.save), n: results.on.save.length },
      }),
    )
  }, 10 * 60_000)
})
