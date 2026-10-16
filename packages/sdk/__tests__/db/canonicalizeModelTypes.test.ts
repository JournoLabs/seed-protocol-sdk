import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray } from 'drizzle-orm'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('canonicalizeModelTypes (ADR 0008)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'canonical-model-types-test',
        models: { CanonHTMLPage: { properties: { title: { type: 'Text' } } }, CanonID3Tag: { properties: {} } },
      }),
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it("rewrites stored types to the matching model's EAS name, and leaves unmatched ones", async () => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, versions, metadata } = await import('@/seedSchema')
    const { canonicalizeModelTypes } = await import('@/db/canonicalizeModelTypes')
    const appDb = BaseDb.getAppDb()
    const now = Date.now()

    // Synced by an older SDK (simple snake_case), created locally with drizzle's snake_case, and
    // a type no local model has.
    await appDb.insert(seeds).values([
      { localId: 'canon-seed-1', type: 'canon_htmlpage', createdAt: now },
      { localId: 'canon-seed-2', type: 'canon_id_3_tag', createdAt: now },
      { localId: 'canon-seed-3', type: 'somebody_elses_model', createdAt: now },
    ])
    await appDb.insert(versions).values({ localId: 'canon-version-1', seedLocalId: 'canon-seed-1', seedType: 'canon_htmlpage', createdAt: now })
    await appDb.insert(metadata).values({
      localId: 'canon-meta-1',
      seedLocalId: 'canon-seed-1',
      propertyName: 'title',
      propertyValue: 'Hi',
      modelType: 'canon_htmlpage',
      createdAt: now,
    })

    expect(await canonicalizeModelTypes()).toBeGreaterThanOrEqual(2)

    const seedRows = await appDb
      .select({ localId: seeds.localId, type: seeds.type })
      .from(seeds)
      .where(inArray(seeds.localId, ['canon-seed-1', 'canon-seed-2', 'canon-seed-3']))
    expect(Object.fromEntries(seedRows.map((r: { localId: string; type: string }) => [r.localId, r.type]))).toEqual({
      'canon-seed-1': 'canon_html_page',
      'canon-seed-2': 'canon_id3_tag',
      'canon-seed-3': 'somebody_elses_model',
    })
    const [version] = await appDb.select().from(versions).where(inArray(versions.localId, ['canon-version-1']))
    expect(version.seedType).toBe('canon_html_page')
    const [row] = await appDb.select().from(metadata).where(inArray(metadata.localId, ['canon-meta-1']))
    expect(row.modelType).toBe('canon_html_page')

    expect(await canonicalizeModelTypes()).toBe(0)
  })
})
