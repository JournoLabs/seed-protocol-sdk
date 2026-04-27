import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createActor } from 'xstate'
import { easSyncMachine } from '@/events/item/easSyncManager'
import * as syncDbWithEas from '@/events/item/syncDbWithEas'
import * as easSyncProcess from '@/db/write/easSyncProcess'

describe('easSyncMachine', () => {
  let runSpy: ReturnType<typeof vi.spyOn<typeof syncDbWithEas, 'runSyncFromEas'>>

  beforeEach(() => {
    runSpy = vi.spyOn(syncDbWithEas, 'runSyncFromEas').mockResolvedValue(undefined)
    vi.spyOn(easSyncProcess, 'insertEasSyncProcessRow').mockResolvedValue(1)
    vi.spyOn(easSyncProcess, 'finalizeEasSyncProcessRow').mockResolvedValue(undefined)
  })

  afterEach(() => {
    runSpy.mockRestore()
    vi.restoreAllMocks()
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
    await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1))

    actor.send({
      type: 'REQUEST',
      correlationId: 'c2',
      options: { addresses: ['0xbb'] },
      source: 'client_api',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(runSpy).toHaveBeenCalledTimes(1)

    releaseFirst!()
    await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2))
    expect(runSpy).toHaveBeenLastCalledWith({ addresses: ['0xAa', '0xbb'] })

    actor.stop()
  })
})
