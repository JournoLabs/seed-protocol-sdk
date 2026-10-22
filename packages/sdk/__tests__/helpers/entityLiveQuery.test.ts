import { describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'
import { of, type Subscription } from 'rxjs'
import { setupEntityLiveQuery } from '@/helpers/entity/entityLiveQuery'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

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

describe('setupEntityLiveQuery', () => {
  it('sets up when the entity id is available at once', async () => {
    const entity = createIdleEntity()
    const { queryInitialData, updateContext } = setup(entity, async () => 7)
    await vi.waitFor(() => expect(updateContext).toHaveBeenCalledWith(entity, ['child-1']), { timeout: WAIT_TIMEOUT_MS })
    expect(queryInitialData).toHaveBeenCalledWith(7)
  })

  it('retries the entity id on each snapshot until it has one', async () => {
    const entity = createIdleEntity()
    let rowWritten = false
    const getEntityId = vi.fn(async () => (rowWritten ? 7 : undefined))
    const { queryInitialData } = setup(entity, getEntityId)

    await vi.waitFor(() => expect(getEntityId).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT_MS })
    expect(queryInitialData).not.toHaveBeenCalled()

    // The entity learns its row id from its load or its own row write, both of which change its snapshot
    rowWritten = true
    entity.getService().send({ type: 'ping' })
    await vi.waitFor(() => expect(queryInitialData).toHaveBeenCalledWith(7), { timeout: WAIT_TIMEOUT_MS })

    const calls = getEntityId.mock.calls.length
    entity.getService().send({ type: 'ping' })
    expect(getEntityId).toHaveBeenCalledTimes(calls)
  })

  it('stops retrying once the entity is stopped', async () => {
    const entity = createIdleEntity()
    const getEntityId = vi.fn(async () => undefined)
    setup(entity, getEntityId)

    await vi.waitFor(() => expect(getEntityId).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT_MS })
    entity.getService().stop()
    const calls = getEntityId.mock.calls.length
    entity.getService().send({ type: 'ping' })
    expect(getEntityId).toHaveBeenCalledTimes(calls)
  })
})
