import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const SEED_UID = '0x' + 'b'.repeat(64)
const VERSION_UID = '0x' + 'c'.repeat(64)
const METADATA_UID = '0x' + 'd'.repeat(64)

// created_at and updated_at come from the columns' $defaultFn/$onUpdate, so writers that never name
// them still set them.
testDescribe('created_at and updated_at defaults on seeds, versions and metadata', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('sets updated_at on insert and bumps it on update', async () => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, versions, metadata } = await import('@/seedSchema')
    const { createSeed } = await import('@/db/write/createSeed')
    const { createVersion } = await import('@/db/write/createVersion')
    const { updateSeedUid } = await import('@/db/write/updateSeedUid')
    const appDb = BaseDb.getAppDb()

    const before = Date.now()
    const seedLocalId = await createSeed(
      { type: 'updated_at_defaults_test' },
      { fields: { schemaUid: null, publisher: undefined } },
    )
    const versionLocalId = await createVersion({ seedLocalId, seedType: 'updated_at_defaults_test', uid: VERSION_UID })
    const metadataLocalId = 'updated-at-defaults-meta'
    await appDb.insert(metadata).values({
      localId: metadataLocalId,
      uid: METADATA_UID,
      seedLocalId,
      versionLocalId,
      propertyName: 'title',
      propertyValue: 'Hi',
      modelType: 'updated_at_defaults_test',
    })

    const readTimes = async () => {
      const [seed] = await appDb
        .select({ createdAt: seeds.createdAt, updatedAt: seeds.updatedAt })
        .from(seeds)
        .where(eq(seeds.localId, seedLocalId))
      const [version] = await appDb
        .select({ createdAt: versions.createdAt, updatedAt: versions.updatedAt })
        .from(versions)
        .where(eq(versions.localId, versionLocalId))
      const [meta] = await appDb
        .select({ createdAt: metadata.createdAt, updatedAt: metadata.updatedAt })
        .from(metadata)
        .where(eq(metadata.localId, metadataLocalId))
      return { seed, version, meta }
    }

    for (const row of Object.values(await readTimes())) {
      expect(row.createdAt).toBeGreaterThanOrEqual(before)
      expect(row.updatedAt).toBeGreaterThanOrEqual(before)
    }

    // An explicit value still wins over the hooks.
    await appDb.update(versions).set({ updatedAt: 1 }).where(eq(versions.localId, versionLocalId))
    await appDb.update(metadata).set({ updatedAt: 1 }).where(eq(metadata.localId, metadataLocalId))
    expect(await readTimes()).toMatchObject({ version: { updatedAt: 1 }, meta: { updatedAt: 1 } })

    // updateSeedUid's versions/metadata cascade does not name updated_at.
    const beforeUpdate = Date.now()
    await updateSeedUid({ seedLocalId, seedUid: SEED_UID })
    const [version] = await appDb.select().from(versions).where(eq(versions.localId, versionLocalId))
    const [meta] = await appDb.select().from(metadata).where(eq(metadata.localId, metadataLocalId))
    expect(version.seedUid).toBe(SEED_UID)
    expect(meta.seedUid).toBe(SEED_UID)
    expect(version.updatedAt).toBeGreaterThanOrEqual(beforeUpdate)
    expect(meta.updatedAt).toBeGreaterThanOrEqual(beforeUpdate)
    // created_at has no $onUpdate.
    expect(version.createdAt).toBeLessThan(beforeUpdate + 1)
    expect(meta.createdAt).toBeLessThan(beforeUpdate + 1)
  })
})
