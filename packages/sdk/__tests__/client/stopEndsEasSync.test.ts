import { beforeAll, describe, expect, it, vi } from 'vitest'
import { desc } from 'drizzle-orm'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { easSyncProcesses } from '@/seedSchema/EasSyncProcessSchema'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const fakeEas = vi.hoisted(() => ({ hang: false, reads: 0 }))

vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    // An indexer that never answers while `hang` is set.
    getModelSchemasFromEas: () => {
      fakeEas.reads++
      return fakeEas.hang ? new Promise(() => {}) : Promise.resolve([])
    },
  }
})

const address = '0x1234567890123456789012345678901234567890'

describe('client.stop() during an EAS sync', () => {
  let options: Parameters<typeof client.init>[0]

  beforeAll(async () => {
    const initSpy = vi.spyOn(client, 'init')
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    options = initSpy.mock.calls[0][0]
    initSpy.mockRestore()
  }, SETUP_HOOK_TIMEOUT_MS)

  it('fails the sync, records it before the database closes, and init syncs again', async () => {
    fakeEas.hang = true
    const readsBefore = fakeEas.reads
    const sync = client.syncFromEas({ addresses: [address] })
    const failure = expect(sync).rejects.toThrow('EAS sync stopped')
    await vi.waitFor(() => expect(fakeEas.reads).toBeGreaterThan(readsBefore), { timeout: 10_000 })

    await client.stop()
    await failure

    fakeEas.hang = false
    await client.init(options)
    const [row] = await BaseDb.getAppDb()!
      .select()
      .from(easSyncProcesses)
      .orderBy(desc(easSyncProcesses.id))
      .limit(1)
    expect(row.status).toBe('failed')
    expect(row.errorMessage).toContain('EAS sync stopped')

    await expect(client.syncFromEas({ addresses: [address] })).resolves.toBeUndefined()
  }, 60000)
})
