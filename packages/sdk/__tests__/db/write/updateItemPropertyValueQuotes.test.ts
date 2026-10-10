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

/** Every write path of updateItemPropertyValue stores a value with quotes exactly as given. */
describe.sequential('updateItemPropertyValue stores quotes as given', () => {
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

  it('new row, draft-row update and new row after an attested one', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'plain' })
    const seedLocalId = item.seedLocalId!
    const versionLocalId = item.latestVersionLocalId!

    // No row yet for this property: insert.
    await updateItemPropertyValue({
      seedLocalId,
      versionLocalId,
      propertyName: 'quotedNote',
      modelName: 'Post',
      newValue: "it's",
    })
    expect((await rowsFor(seedLocalId, 'quotedNote')).map((r: any) => r.propertyValue)).toEqual(["it's"])

    // Draft row (no uid): updated in place.
    await updateItemPropertyValue({
      seedLocalId,
      versionLocalId,
      propertyName: 'quotedNote',
      modelName: 'Post',
      newValue: "can't won't",
    })
    expect((await rowsFor(seedLocalId, 'quotedNote')).map((r: any) => r.propertyValue)).toEqual([
      "can't won't",
    ])

    // Attested row: a new draft row is inserted next to it.
    await BaseDb.getAppDb()
      .update(metadata)
      .set({ uid: '0x' + '9'.repeat(64) })
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'quotedNote')))
    await updateItemPropertyValue({
      seedLocalId,
      versionLocalId,
      propertyName: 'quotedNote',
      modelName: 'Post',
      newValue: "'quoted', ''twice''",
      localStorageDir: "dir'with'quotes",
    })
    const rows = await rowsFor(seedLocalId, 'quotedNote')
    const draft = rows.find((r: any) => !r.uid)
    expect(draft?.propertyValue).toBe("'quoted', ''twice''")
    expect(draft?.localStorageDir).toBe("dir'with'quotes")
  })
})
