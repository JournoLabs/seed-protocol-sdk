import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createActor, setup } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { waitForDb } from '@/Item/service/actors/waitForDb'

const machine = setup({ actors: { waitForDb } }).createMachine({
  initial: 'waiting',
  states: {
    waiting: {
      on: { waitForDbSuccess: 'ready' },
      invoke: { src: 'waitForDb', input: ({ context }) => ({ context }) as any },
    },
    ready: {},
  },
})

describe('waitForDb', () => {
  let appDb: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    appDb = undefined
    vi.spyOn(BaseDb, 'getAppDb').mockImplementation(() => appDb as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('sends waitForDbSuccess once the app db exists, then stops polling', () => {
    const actor = createActor(machine).start()
    vi.advanceTimersByTime(300)
    expect(actor.getSnapshot().value).toBe('waiting')

    appDb = {}
    vi.advanceTimersByTime(100)
    expect(actor.getSnapshot().value).toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
    actor.stop()
  })

  // Regression: the polling interval was only cleared once the db appeared, so stopping an item first
  // left it running forever.
  it('stops polling when stopped before the db is ready', () => {
    const actor = createActor(machine).start()
    expect(vi.getTimerCount()).toBe(1)

    actor.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
