import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models } from '@/seedSchema'
import { ensureModelStubs } from '@/client/actors/addModelsToDb'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

describe('ensureModelStubs', () => {
  const suffix = Math.random().toString(36).slice(2, 8)
  const names = [`StubA${suffix}`, `StubB${suffix}`]

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await BaseDb.getAppDb()?.delete(models).where(inArray(models.name, names))
  })

  it('inserts each missing stub once when two inits run at the same time', async () => {
    const appDb = BaseDb.getAppDb()!
    // Two tabs initializing together: both check before either inserts unless they take turns.
    await Promise.all([
      ensureModelStubs(appDb, names, '/stub-test'),
      ensureModelStubs(appDb, names, '/stub-test'),
    ])

    const rows = await appDb.select({ name: models.name }).from(models).where(inArray(models.name, names))
    expect(rows.map((row) => row.name).sort()).toEqual([...names].sort())
  })
})
