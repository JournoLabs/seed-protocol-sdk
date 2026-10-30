import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createActor } from 'xstate'
import {
  easSyncActor,
  easSyncMachine,
  requestEasSyncFromModelsInit,
  startEasSyncActor,
} from '@/events/item/easSyncManager'
import { cancelAllRetriesWhenOnline, setRetriesWhenOnlineEnabled } from '@/helpers/retryWhenOnline'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

// vi.mock rather than vi.spyOn on the module namespace: ESM namespaces aren't configurable in browser
// mode ("Module namespace is not configurable in ESM").
const { runSyncFromEas } = vi.hoisted(() => ({ runSyncFromEas: vi.fn() }))
// easSyncManager only imports runSyncFromEas (lazily) from this module; loading the real module
// pulls in the whole sync pipeline.
vi.mock('@/events/item/syncDbWithEas', () => ({ runSyncFromEas }))
vi.mock('@/db/write/easSyncProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/write/easSyncProcess')>()),
  failInterruptedEasSyncProcessRows: vi.fn().mockResolvedValue(0),
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

  it('runs a failed automatic sync again later (offline at startup)', async () => {
    const previousRetrySetting = setRetriesWhenOnlineEnabled(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      runSpy.mockRejectedValueOnce(new TypeError('fetch failed'))
      requestEasSyncFromModelsInit()
      await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(easSyncActor.getSnapshot().value).toBe('idle'))
      expect(easSyncActor.getSnapshot().context.lastFinishedStatus).toBe('failed')

      await vi.advanceTimersByTimeAsync(15_000)
      await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2))
      await vi.waitFor(() =>
        expect(easSyncActor.getSnapshot().context.lastFinishedStatus).toBe('success'),
      )
      // A full sync failed, so the retry is a full sync too.
      expect(runSpy).toHaveBeenLastCalledWith(undefined)
    } finally {
      cancelAllRetriesWhenOnline()
      setRetriesWhenOnlineEnabled(previousRetrySetting)
      vi.useRealTimers()
    }
  })

  it("retries the automatic requests merged into a failed run that a client_api request started (K2.3)", async () => {
    const previousRetrySetting = setRetriesWhenOnlineEnabled(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let releaseFirst: (() => void) | undefined
      runSpy.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      runSpy.mockRejectedValueOnce(new TypeError('fetch failed'))
      runSpy.mockResolvedValue(undefined)
      startEasSyncActor()

      easSyncActor.send({ type: 'REQUEST', correlationId: 'k1', options: { addresses: ['0xaa'] }, source: 'client_api' })
      await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1))
      easSyncActor.send({ type: 'REQUEST', correlationId: 'k2', options: { addresses: ['0xbb'] }, source: 'client_api' })
      easSyncActor.send({ type: 'REQUEST', correlationId: 'k3', options: { addresses: ['0xcc'] }, source: 'models_init' })
      releaseFirst!()

      // The merged run (started by k2, a client_api request) fails
      await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(easSyncActor.getSnapshot().context.lastFinishedStatus).toBe('failed'))

      await vi.advanceTimersByTimeAsync(15_000)
      await vi.waitFor(() => expect(runSpy).toHaveBeenCalledTimes(3))
      // Only the automatic request's addresses: client_api callers got the error
      expect(runSpy).toHaveBeenLastCalledWith({ addresses: ['0xcc'] })
    } finally {
      cancelAllRetriesWhenOnline()
      setRetriesWhenOnlineEnabled(previousRetrySetting)
      vi.useRealTimers()
    }
  })
})
