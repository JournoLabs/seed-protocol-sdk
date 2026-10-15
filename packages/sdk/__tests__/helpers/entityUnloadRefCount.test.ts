import { describe, it, expect } from 'vitest'
import { unloadEntity } from '@/helpers/entity/entityUnload'

/** unload() releases one reference; the service stops only when the last one is released. */
describe('unloadEntity', () => {
  const setup = (refCount: number) => {
    let stopped = 0
    const instance = {}
    const cache = new Map<string, { instance: object; refCount: number }>([['k', { instance, refCount }]])
    const config = {
      getCacheKeys: () => ['k'],
      caches: [cache],
      instanceState: new WeakMap(),
      getService: () => ({ stop: () => { stopped += 1 } }),
    }
    return { instance, cache, config, stopped: () => stopped }
  }

  it('keeps the service running while other references remain', () => {
    const { instance, cache, config, stopped } = setup(2)
    unloadEntity(instance, config as any)
    expect(stopped()).toBe(0)
    expect(cache.get('k')?.refCount).toBe(1)
  })

  it('stops the service and removes the entry with the last reference', () => {
    const { instance, cache, config, stopped } = setup(1)
    unloadEntity(instance, config as any)
    expect(stopped()).toBe(1)
    expect(cache.has('k')).toBe(false)
  })
})
