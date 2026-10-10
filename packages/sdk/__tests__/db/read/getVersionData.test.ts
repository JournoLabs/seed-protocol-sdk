import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { getVersionData } from '@/db/read/getVersionData'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

/** `seedLocalId` selects versions by the seed they belong to (versions.seed_local_id). */
describe.sequential('getVersionData seedLocalId filter', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })

    await BaseDb.getAppDb()
      .insert(versions)
      .values([
        { localId: 'gvd-version-a', seedLocalId: 'gvd-seed-a', seedType: 'gvd_post', createdAt: 1_000 },
        { localId: 'gvd-version-b', seedLocalId: 'gvd-seed-b', seedType: 'gvd_post', createdAt: 1_000 },
      ])
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('returns the version of the given seed', async () => {
    const row = await getVersionData({ seedLocalId: 'gvd-seed-b' })
    expect(row?.localId).toBe('gvd-version-b')
  })

  it('combines with localId: a version of another seed does not match', async () => {
    expect(await getVersionData({ seedLocalId: 'gvd-seed-a', localId: 'gvd-version-a' })).toMatchObject({
      localId: 'gvd-version-a',
    })
    expect(await getVersionData({ seedLocalId: 'gvd-seed-a', localId: 'gvd-version-b' })).toBeUndefined()
  })
})
