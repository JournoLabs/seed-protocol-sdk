import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createActor } from 'xstate'
import { easSyncMachine } from '@/events/item/easSyncManager'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

// vi.mock rather than vi.spyOn on the module namespace: ESM namespaces aren't configurable in browser
// mode ("Module namespace is not configurable in ESM").
const { runSyncFromEas } = vi.hoisted(() => ({ runSyncFromEas: vi.fn() }))
// easSyncManager only imports runSyncFromEas (lazily) from this module; loading the real module
// pulls in the whole sync pipeline.
vi.mock('@/events/item/syncDbWithEas', () => ({ runSyncFromEas }))
vi.mock('@/db/write/easSyncProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/write/easSyncProcess')>()),
  insertEasSyncProcessRow: vi.fn().mockResolvedValue(1),
  finalizeEasSyncProcessRow: vi.fn().mockResolvedValue(undefined),
}))

describe('easSyncMachine', () => {
  const runSpy = runSyncFromEas

  beforeEach(() => {
    runSpy.mockReset()
    runSpy.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('merges requests received while a sync is in flight into the next run', async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    runSpy.mockImplementationOnce(async () => {
      await firstGate
    })
    runSpy.mockResolvedValue(undefined)

    const actor = createActor(easSyncMachine)
    actor.start()

    actor.send({
      type: 'REQUEST',
      correlationId: 'c1',
      options: { addresses: ['0xAa'] },
      source: 'client_api',
    })
    await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1), { timeout: WAIT_TIMEOUT_MS })

    actor.send({
      type: 'REQUEST',
      correlationId: 'c2',
      options: { addresses: ['0xbb'] },
      source: 'client_api',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(runSpy).toHaveBeenCalledTimes(1)

    releaseFirst!()
    await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2), { timeout: WAIT_TIMEOUT_MS })
    expect(runSpy).toHaveBeenLastCalledWith({ addresses: ['0xAa', '0xbb'] })

    actor.stop()
  })
})
