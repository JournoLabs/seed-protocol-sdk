import { describe, it, expect } from 'vitest'
import { EntityCache, evictionLog } from '@/helpers/entity/entityCache'
import {
  destroyEntity,
  entityStatus,
  evictEntities,
  holdChild,
  isEntityTornDown,
  onEntityTeardown,
  releaseChildHold,
  releaseEntity,
  runEntityLoad,
  subscribeEntityStatus,
  teardownEntity,
  waitForEntityReady,
} from '@/helpers/entity/entityLifecycle'

/** A stand-in entity: an actor that records stops and events, and a proxy sharing it. */
const makeEntity = (name = 'e') => {
  const actor = { stopped: 0, events: [] as string[], stop() { this.stopped += 1 }, send(event: { type: string }) { this.events.push(event.type) } }
  const instance = { name, getService: () => actor }
  const proxy = new Proxy(instance, {})
  return { instance, proxy, actor }
}
type Entity = ReturnType<typeof makeEntity>['instance']

describe('EntityCache', () => {
  it('stores one entry under every key and finds it from the proxy', () => {
    const cache = new EntityCache<Entity>()
    const { instance, proxy } = makeEntity()
    cache.add(instance, ['id-1', 'name-a', undefined], { hold: true })
    expect(cache.peek('id-1')).toBe(instance)
    expect(cache.peek('name-a')).toBe(instance)
    expect(cache.entryOf(proxy)).toBe(cache.entryOf(instance))
    expect(cache.instances()).toEqual([instance])
  })

  it('peek takes no hold; hold and release count', () => {
    const cache = new EntityCache<Entity>()
    const { instance } = makeEntity()
    cache.add(instance, ['id-1'], { hold: false })
    cache.peek('id-1')
    expect(cache.entryOf(instance)?.refCount).toBe(0)
    expect(cache.hold('id-1')).toBe(instance)
    expect(cache.release(instance)).toBe(true)
  })

  it('setKeys drops the old alias on a rename', () => {
    const cache = new EntityCache<Entity>()
    const { instance } = makeEntity()
    cache.add(instance, ['id-1', 'A'], { hold: true })
    cache.setKeys(instance, ['id-1', 'B'])
    expect(cache.peek('A')).toBeUndefined()
    expect(cache.peek('B')).toBe(instance)
  })

  it('remove deletes every key the entry owns', () => {
    const cache = new EntityCache<Entity>()
    const { instance } = makeEntity()
    cache.add(instance, ['id-1', 'A', 'alias'], { hold: true })
    cache.remove(instance)
    expect(cache.peek('id-1') ?? cache.peek('A') ?? cache.peek('alias')).toBeUndefined()
  })

  it('a key taken by a newer instance leaves the older entry, and releasing the older one keeps it', () => {
    const cache = new EntityCache<Entity>()
    const older = makeEntity('older').instance
    const newer = makeEntity('newer').instance
    cache.add(older, ['id-1', 'A'], { hold: true })
    cache.add(newer, ['id-2', 'A'], { hold: true })
    expect(cache.peek('A')).toBe(newer)
    releaseEntity(older, cache)
    expect(cache.peek('A')).toBe(newer)
    expect(cache.entryOf(newer)?.refCount).toBe(1)
  })
})

describe('entity lifecycle', () => {
  it('releaseEntity tears down only with the last hold', () => {
    const cache = new EntityCache<Entity>()
    const { instance, actor } = makeEntity()
    cache.add(instance, ['id-1'], { hold: true })
    cache.holdInstance(instance)
    releaseEntity(instance, cache)
    expect(actor.stopped).toBe(0)
    releaseEntity(instance, cache)
    expect(actor.stopped).toBe(1)
    expect(cache.peek('id-1')).toBeUndefined()
    expect(isEntityTornDown(instance)).toBe(true)
  })

  it('teardown runs disposers once and releases children', () => {
    const parents = new EntityCache<Entity>()
    const children = new EntityCache<Entity>()
    const parent = makeEntity('parent')
    const child = makeEntity('child')
    parents.add(parent.instance, ['p'], { hold: true })
    children.add(child.instance, ['c'], { hold: false })
    expect(holdChild(parent.proxy, child.instance, children)).toBe(true)
    expect(holdChild(parent.instance, child.proxy, children)).toBe(true)
    expect(children.entryOf(child.instance)?.refCount).toBe(1)
    let disposed = 0
    onEntityTeardown(parent.instance, () => { disposed += 1 })
    teardownEntity(parent.proxy, parents)
    teardownEntity(parent.instance, parents)
    expect(disposed).toBe(1)
    expect(child.actor.stopped).toBe(1)
    expect(children.peek('c')).toBeUndefined()
  })

  it('releaseChildHold gives back the parent hold once', () => {
    const children = new EntityCache<Entity>()
    const parent = makeEntity('parent')
    const child = makeEntity('child')
    children.add(child.instance, ['c'], { hold: true })
    holdChild(parent.instance, child.instance, children)
    releaseChildHold(parent.instance, child.instance)
    releaseChildHold(parent.instance, child.instance)
    expect(children.entryOf(child.instance)?.refCount).toBe(1)
  })

  it('evictEntities ignores holds', () => {
    const cache = new EntityCache<Entity>()
    const a = makeEntity('a')
    const b = makeEntity('b')
    cache.add(a.instance, ['a'], { hold: true })
    cache.add(b.instance, ['b'], { hold: true })
    expect(evictEntities(cache, (e) => e.name === 'a')).toEqual([a.instance])
    expect(a.actor.stopped).toBe(1)
    expect(cache.peek('b')).toBe(b.instance)
  })

  it('destroyEntity leaves the cache first and stops after the rows are gone', async () => {
    const cache = new EntityCache<Entity>()
    const { instance, actor } = makeEntity()
    cache.add(instance, ['id-1'], { hold: true })
    let seenDuringDelete: unknown = 'unset'
    await destroyEntity(instance, cache, async () => {
      seenDuringDelete = cache.peek('id-1')
      expect(actor.stopped).toBe(0)
    })
    expect(seenDuringDelete).toBeUndefined()
    expect(actor.stopped).toBe(1)
    expect(actor.events).toEqual(['destroyStarted'])
  })

  it('destroyEntity records and rethrows a failed delete', async () => {
    const cache = new EntityCache<Entity>()
    const { instance, actor } = makeEntity()
    cache.add(instance, ['id-1'], { hold: true })
    await expect(destroyEntity(instance, cache, async () => { throw new Error('locked') })).rejects.toThrow('locked')
    expect(actor.events).toEqual(['destroyStarted', 'destroyError'])
    expect(actor.stopped).toBe(1)
  })

  it('status follows the load, and waiters settle', async () => {
    const { instance } = makeEntity()
    const seen: string[] = []
    subscribeEntityStatus(instance, (status) => seen.push(status))
    expect(entityStatus(instance)).toBe('loading')
    const waiting = waitForEntityReady(instance)
    await runEntityLoad(instance, async () => {})
    await waiting
    expect(entityStatus(instance)).toBe('ready')
    expect(seen).toEqual(['ready'])
  })

  it('a failed load rejects waiters unless throwOnError is false', async () => {
    const { instance } = makeEntity()
    await runEntityLoad(instance, async () => { throw new Error('no row') })
    expect(entityStatus(instance)).toBe('error')
    await expect(waitForEntityReady(instance)).rejects.toThrow('no row')
    await expect(waitForEntityReady(instance, { throwOnError: false })).resolves.toBeUndefined()
  })

  it('teardown during a load settles waiters with an error', async () => {
    const cache = new EntityCache<Entity>()
    const { instance } = makeEntity()
    cache.add(instance, ['id-1'], { hold: true })
    const waiting = waitForEntityReady(instance)
    releaseEntity(instance, cache)
    await expect(waiting).rejects.toThrow('unloaded before it finished loading')
  })

  it('waitForEntityReady times out', async () => {
    const { instance } = makeEntity()
    await expect(waitForEntityReady(instance, { timeout: 10 })).rejects.toThrow('timeout after 10ms')
    await expect(waitForEntityReady(instance, { timeout: 10, throwOnError: false })).resolves.toBeUndefined()
  })
})

describe('evictionLog', () => {
  it('reports an eviction after the capture, scoped', () => {
    const since = evictionLog.now()
    evictionLog.evict(['schema:A'])()
    expect(evictionLog.evictedSince(['schema:A'], since)).toBe(true)
    expect(evictionLog.evictedSince(['schema:B'], since)).toBe(false)
    expect(evictionLog.evictedSince(['schema:A'], evictionLog.now())).toBe(false)
  })

  it('counts a scope as evicted while its destroy runs', () => {
    const finish = evictionLog.evict(['model:m1'])
    const startedDuring = evictionLog.now()
    expect(evictionLog.evictedSince(['model:m1'], startedDuring)).toBe(true)
    finish()
    expect(evictionLog.evictedSince(['model:m1'], startedDuring)).toBe(true)
    expect(evictionLog.evictedSince(['model:m1'], evictionLog.now())).toBe(false)
  })
})
