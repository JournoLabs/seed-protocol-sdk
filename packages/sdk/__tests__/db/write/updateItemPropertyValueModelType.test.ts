import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * Stored model types are the model's EAS name (ADR 0008): `blog_post` for BlogPost. The rows here
 * belong to a Post item and are relabelled; updateItemPropertyValue only reads them by seed and
 * property.
 */
describe.sequential('updateItemPropertyValue model types and unchanged values', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const rowsFor = (seedLocalId: string, propertyName: string) =>
    BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)))

  it('writes the EAS name as the model type', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'plain' })
    await updateItemPropertyValue({
      seedLocalId: item.seedLocalId!,
      versionLocalId: item.latestVersionLocalId!,
      propertyName: 'subtitle',
      modelName: 'BlogPost',
      newValue: 'first',
    })
    const rows = await rowsFor(item.seedLocalId!, 'subtitle')
    expect(rows.map((r: any) => r.modelType)).toEqual(['blog_post'])
  })

  // Plain values pass no ref fields, as analyzeInput calls it; the DB holds null for them.
  it.each([
    ['BlogPost', 'blog_post'],
    ['Post', 'post'],
  ])('leaves a published %s value alone when the same value is assigned again', async (modelName, modelType) => {
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'plain' })
    const seedLocalId = item.seedLocalId!
    await updateItemPropertyValue({
      seedLocalId,
      versionLocalId: item.latestVersionLocalId!,
      propertyName: 'summary',
      modelName,
      newValue: 'published text',
    })
    await BaseDb.getAppDb()
      .update(metadata)
      .set({ uid: '0x' + '7'.repeat(64), modelType })
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'summary')))

    const result = await updateItemPropertyValue({
      seedLocalId,
      versionLocalId: item.latestVersionLocalId!,
      propertyName: 'summary',
      modelName,
      newValue: 'published text',
    })

    const rows = await rowsFor(seedLocalId, 'summary')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.uid).toBe('0x' + '7'.repeat(64))
    // The value stays in the published row, so the property keeps reading as attested.
    expect(result).toMatchObject({ localId: rows[0]?.localId, uid: '0x' + '7'.repeat(64) })
  })
})
