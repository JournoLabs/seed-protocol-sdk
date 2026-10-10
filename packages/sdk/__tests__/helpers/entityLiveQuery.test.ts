import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'
import { of, type Subscription } from 'rxjs'
import { setupEntityLiveQuery } from '@/helpers/entity/entityLiveQuery'

/** An idle entity: its snapshot never changes unless the test sends an event. */
const createIdleEntity = () => {
  const actor = createActor(createMachine({ initial: 'idle', states: { idle: { on: { ping: {} } } } }))
  actor.start()
  return { getService: () => actor }
}

const setup = (entity: ReturnType<typeof createIdleEntity>, getEntityId: () => Promise<number | undefined>) => {
  const queryInitialData = vi.fn(async () => [{ id: 'child-1' }])
  const updateContext = vi.fn()
  setupEntityLiveQuery(entity, {
    getEntityId,
    buildQuery: () => of([{ id: 'child-1' }]),
    extractEntityIds: (rows) => rows.map((row: { id: string }) => row.id),
    updateContext,
    queryInitialData,
    instanceState: new WeakMap([[entity, { liveQuerySubscription: null as Subscription | null }]]),
    loggerName: 'seedSdk:test:entityLiveQuery',
  })
  return { queryInitialData, updateContext }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('setupEntityLiveQuery', () => {
  it('sets up when the entity id is available at once', async () => {
    const entity = createIdleEntity()
    const { queryInitialData, updateContext } = setup(entity, async () => 7)
    await vi.waitFor(() => expect(updateContext).toHaveBeenCalledWith(entity, ['child-1']))
    expect(queryInitialData).toHaveBeenCalledWith(7)
  })

  it('keeps retrying the entity id while the entity is idle (row written later)', async () => {
    vi.useFakeTimers()
    const entity = createIdleEntity()
    let rowWritten = false
    const getEntityId = vi.fn(async () => (rowWritten ? 7 : undefined))
    const { queryInitialData } = setup(entity, getEntityId)

    await vi.advanceTimersByTimeAsync(500)
    expect(queryInitialData).not.toHaveBeenCalled()

    // No snapshot change: only the retry timer can notice the row.
    rowWritten = true
    await vi.advanceTimersByTimeAsync(2000)
    expect(queryInitialData).toHaveBeenCalledWith(7)

    const calls = getEntityId.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getEntityId).toHaveBeenCalledTimes(calls)
  })

  it('stops retrying once the entity is stopped', async () => {
    vi.useFakeTimers()
    const entity = createIdleEntity()
    const getEntityId = vi.fn(async () => undefined)
    setup(entity, getEntityId)

    await vi.advanceTimersByTimeAsync(500)
    entity.getService().stop()
    const calls = getEntityId.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getEntityId).toHaveBeenCalledTimes(calls)
  })

  it('gives up after about a minute', async () => {
    vi.useFakeTimers()
    const entity = createIdleEntity()
    const getEntityId = vi.fn(async () => undefined)
    setup(entity, getEntityId)

    await vi.advanceTimersByTimeAsync(70_000)
    const calls = getEntityId.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getEntityId).toHaveBeenCalledTimes(calls)
  })
})
