import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { easSyncProcesses } from '@/seedSchema/EasSyncProcessSchema'
import {
  INTERRUPTED_SYNC_MESSAGE,
  failInterruptedEasSyncProcessRows,
  finalizeEasSyncProcessRow,
  insertEasSyncProcessRow,
} from '@/db/write/easSyncProcess'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('failInterruptedEasSyncProcessRows', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('marks rows left in progress failed, and leaves finished rows alone', async () => {
    const row = { requestPayload: { source: 'models_init' }, persistedSnapshot: { phase: 'running' } }
    const interrupted = await insertEasSyncProcessRow(row)
    const finished = await insertEasSyncProcessRow(row)
    await finalizeEasSyncProcessRow(finished, { status: 'completed', persistedSnapshot: { phase: 'completed' } })

    expect(await failInterruptedEasSyncProcessRows()).toBeGreaterThanOrEqual(1)

    const rows = await BaseDb.getAppDb()
      .select()
      .from(easSyncProcesses)
      .where(inArray(easSyncProcesses.id, [interrupted, finished]))
    const byId = new Map(rows.map((r: typeof easSyncProcesses.$inferSelect) => [r.id, r]))
    expect(byId.get(interrupted)?.status).toBe('failed')
    expect(byId.get(interrupted)?.errorMessage).toBe(INTERRUPTED_SYNC_MESSAGE)
    expect(byId.get(interrupted)?.completedAt).toBeTruthy()
    expect(byId.get(finished)?.status).toBe('completed')
    expect(byId.get(finished)?.errorMessage ?? null).toBeNull()
  })
})
