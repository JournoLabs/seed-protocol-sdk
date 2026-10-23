import { describe, it, expect, afterEach, vi } from 'vitest'
import { EntityCache, flushPendingEntityUnloads, setEntityUnloadGraceMs } from '@/helpers/entity/entityCache'
import { isEntityTornDown, releaseEntity } from '@/helpers/entity/entityLifecycle'

/** Stands in for an entity: the cache only needs its actor. */
function makeEntity() {
  const actor = { stopped: false, stop() { this.stopped = true } }
  return { actor, getService: () => actor }
}
type Entity = ReturnType<typeof makeEntity>

describe('EntityCache grace period', () => {
  afterEach(() => {
    vi.useRealTimers()
    setEntityUnloadGraceMs(undefined)
  })

  it('tears an instance down only after the grace period, unless a hold is taken first', () => {
    vi.useFakeTimers()
    setEntityUnloadGraceMs(1000)
    const cache = new EntityCache<Entity>()
    const entity = makeEntity()
    cache.add(entity, ['a'], { hold: true })

    releaseEntity(entity, cache)
    vi.advanceTimersByTime(999)
    expect(entity.actor.stopped).toBe(false)
    expect(cache.hold('a')).toBe(entity)
    vi.advanceTimersByTime(5000)
    expect(entity.actor.stopped).toBe(false)

    releaseEntity(entity, cache)
    vi.advanceTimersByTime(1000)
    expect(entity.actor.stopped).toBe(true)
    expect(isEntityTornDown(entity)).toBe(true)
    expect(cache.peek('a')).toBeUndefined()
  })

  it('unloads an instance added without a hold, and restarts the period on a lookup', () => {
    vi.useFakeTimers()
    setEntityUnloadGraceMs(1000)
    const cache = new EntityCache<Entity>()
    const entity = makeEntity()
    cache.add(entity, ['a'], { hold: false })
    vi.advanceTimersByTime(600)
    cache.keepUnheld(entity)
    vi.advanceTimersByTime(600)
    expect(entity.actor.stopped).toBe(false)
    vi.advanceTimersByTime(400)
    expect(entity.actor.stopped).toBe(true)
  })

  it('tears down at once with a grace period of 0, or an immediate release', () => {
    setEntityUnloadGraceMs(0)
    const cache = new EntityCache<Entity>()
    const first = makeEntity()
    cache.add(first, ['a'], { hold: true })
    releaseEntity(first, cache)
    expect(first.actor.stopped).toBe(true)

    setEntityUnloadGraceMs(60_000)
    const second = makeEntity()
    cache.add(second, ['b'], { hold: true })
    releaseEntity(second, cache, { immediate: true })
    expect(second.actor.stopped).toBe(true)
  })

  it('ignores a release when no one holds the instance', () => {
    setEntityUnloadGraceMs(0)
    const cache = new EntityCache<Entity>()
    const entity = makeEntity()
    cache.add(entity, ['a'], { hold: false })
    releaseEntity(entity, cache)
    expect(entity.actor.stopped).toBe(false)
    expect(cache.entryOf(entity)?.refCount).toBe(0)
  })

  it('flushPendingEntityUnloads tears down what waits, and removal cancels the wait', () => {
    setEntityUnloadGraceMs(60_000)
    const cache = new EntityCache<Entity>()
    const waiting = makeEntity()
    const removed = makeEntity()
    cache.add(waiting, ['a'], { hold: true })
    cache.add(removed, ['b'], { hold: true })
    releaseEntity(waiting, cache)
    releaseEntity(removed, cache)
    cache.remove(removed)

    flushPendingEntityUnloads()
    expect(waiting.actor.stopped).toBe(true)
    expect(removed.actor.stopped).toBe(false)
  })

  it('does not keep a Node process running while a teardown waits', () => {
    setEntityUnloadGraceMs(60_000)
    const unref = vi.fn()
    const realSetTimeout = globalThis.setTimeout
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      const timer = realSetTimeout(fn, ms)
      const original = timer.unref.bind(timer)
      timer.unref = () => {
        unref()
        return original()
      }
      return timer
    }) as typeof setTimeout)
    try {
      const cache = new EntityCache<Entity>()
      const entity = makeEntity()
      cache.add(entity, ['a'], { hold: true })
      releaseEntity(entity, cache)
      expect(unref).toHaveBeenCalledTimes(1)
      cache.remove(entity)
    } finally {
      spy.mockRestore()
    }
  })
})
