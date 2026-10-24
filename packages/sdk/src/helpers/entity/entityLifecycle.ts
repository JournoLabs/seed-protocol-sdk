import { EntityCache, type ActorBacked } from './entityCache'

/**
 * Where an entity is in its load: `loading` until its row and definition are read, then `ready`,
 * or `error` when the load failed or the entity was torn down first.
 */
export type EntityStatus = 'loading' | 'ready' | 'error'

/**
 * Default timeout for create/find/all with waitForReady. Loads that touch OPFS and the DB can take
 * several seconds on slow devices and CI runners; a load that is really stuck still errors.
 */
export const DEFAULT_READY_TIMEOUT_MS = 15_000

type Actor = { stop(): void; send?(event: { type: string; error?: unknown }): void }

interface Lifecycle {
  status: EntityStatus
  error?: unknown
  /** Settles on the first ready or error. */
  settled: Promise<void>
  settle: () => void
  listeners: Set<(status: EntityStatus) => void>
  disposers: Set<() => void>
  /** Holds this entity owns on other entities, by the child's actor (see holdChild). */
  children: Map<object, (options?: { immediate?: boolean }) => void>
  tornDown: boolean
}

// Keyed by actor: a raw instance and its proxy share one.
const lifecycles = new WeakMap<object, Lifecycle>()

function lifecycleOf(instance: ActorBacked): Lifecycle {
  const actor = instance.getService()
  let lifecycle = lifecycles.get(actor)
  if (!lifecycle) {
    let settle!: () => void
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    lifecycle = { status: 'loading', settled, settle, listeners: new Set(), disposers: new Set(), children: new Map(), tornDown: false }
    lifecycles.set(actor, lifecycle)
  }
  return lifecycle
}

export function entityStatus(instance: ActorBacked): EntityStatus {
  return lifecycleOf(instance).status
}

export function setEntityStatus(instance: ActorBacked, status: EntityStatus, error?: unknown): void {
  const lifecycle = lifecycleOf(instance)
  if (lifecycle.tornDown) return
  lifecycle.error = status === 'error' ? error : undefined
  if (lifecycle.status === status) return
  lifecycle.status = status
  if (status !== 'loading') lifecycle.settle()
  // Mirrored into the actor's context, so what subscribes to the actor (React hooks) sees it change.
  // Internal key: no machine revalidates on it.
  const actor = instance.getService() as Actor & { getSnapshot?(): { status: string } }
  if (actor.getSnapshot?.().status === 'active') actor.send?.({ type: 'updateContext', _status: status } as never)
  for (const listener of [...lifecycle.listeners]) listener(status)
}

/** Calls `listener` on each status change. Returns a function that removes it. */
export function subscribeEntityStatus(
  instance: ActorBacked,
  listener: (status: EntityStatus) => void,
): () => void {
  const lifecycle = lifecycleOf(instance)
  lifecycle.listeners.add(listener)
  return () => {
    lifecycle.listeners.delete(listener)
  }
}

/**
 * Run the entity's load: `loading` while it runs, then `ready`, or `error` when it throws. A
 * reload of a ready entity stays `ready` until it settles. Never rejects; read the status.
 */
export async function runEntityLoad(instance: ActorBacked, load: () => Promise<void>): Promise<void> {
  const lifecycle = lifecycleOf(instance)
  if (lifecycle.status === 'error') setEntityStatus(instance, 'loading')
  try {
    await load()
    setEntityStatus(instance, 'ready')
  } catch (error) {
    setEntityStatus(instance, 'error', error)
  }
}

export class EntityLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EntityLoadError'
  }
}

/**
 * Resolves once the entity is `ready`. Rejects with the load's error when it failed, with an
 * EntityLoadError when it was torn down first or `timeout` ms pass; with `throwOnError: false` those
 * resolve instead.
 */
export async function waitForEntityReady(
  instance: ActorBacked,
  options: { timeout?: number; throwOnError?: boolean } = {},
): Promise<void> {
  const { timeout = DEFAULT_READY_TIMEOUT_MS, throwOnError = true } = options
  const lifecycle = lifecycleOf(instance)
  if (lifecycle.status === 'loading') {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeout)
    })
    const result = await Promise.race([lifecycle.settled, timedOut])
    clearTimeout(timer)
    if (result === 'timeout') {
      if (!throwOnError) return
      throw new EntityLoadError(`Entity loading timeout after ${timeout}ms`)
    }
  }
  if (lifecycle.status === 'error' && throwOnError) {
    // The load's own error, so callers see why (a model whose properties couldn't be created)
    const cause = lifecycle.error
    throw cause instanceof Error ? cause : new EntityLoadError('Entity failed to load', { cause })
  }
}

/**
 * A write or publish on an instance that was unloaded (no hold kept it past the grace period,
 * or it was destroyed, evicted or dropped by another tab). Look it up again, and hold it while
 * using it.
 */
export class EntityUnloadedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntityUnloadedError'
  }
}

/** Run `dispose` when the entity is torn down (unsubscribe a watch, revoke an object URL). */
export function onEntityTeardown(instance: ActorBacked, dispose: () => void): void {
  const lifecycle = lifecycleOf(instance)
  if (lifecycle.tornDown) {
    dispose()
    return
  }
  lifecycle.disposers.add(dispose)
}

/**
 * Whether the entity was torn down (unloaded, destroyed, evicted). Async work it started checks
 * this after each await and drops its result.
 */
export function isEntityTornDown(instance: ActorBacked): boolean {
  return lifecycleOf(instance).tornDown
}

/**
 * Remove the entity from its cache, release the holds it owns, run its disposers and stop its
 * actor. Idempotent.
 */
export function teardownEntity<T extends ActorBacked>(instance: T, cache: EntityCache<T>): void {
  cache.remove(instance)
  const lifecycle = lifecycleOf(instance)
  if (lifecycle.tornDown) return
  lifecycle.tornDown = true
  if (lifecycle.status === 'loading') {
    lifecycle.status = 'error'
    lifecycle.error = new EntityLoadError('Entity was unloaded before it finished loading')
    lifecycle.settle()
  }
  // At once: the parent already waited out its grace period, or was destroyed or evicted
  for (const release of lifecycle.children.values()) {
    try {
      release({ immediate: true })
    } catch {
      // A child that fails to release must not keep the rest held
    }
  }
  lifecycle.children.clear()
  for (const dispose of lifecycle.disposers) {
    try {
      dispose()
    } catch {
      // Same: one failed unsubscribe must not block the rest
    }
  }
  lifecycle.disposers.clear()
  lifecycle.listeners.clear()
  try {
    ;(instance.getService() as Actor).stop()
  } catch {
    // Already stopped
  }
}

/**
 * Give back one hold. With the last one the entity is torn down after the grace period (at once
 * with `immediate`, or when the grace period is 0); a hold taken meanwhile keeps it.
 */
export function releaseEntity<T extends ActorBacked>(
  instance: T,
  cache: EntityCache<T>,
  options?: { immediate?: boolean },
): void {
  if (cache.release(instance, options)) teardownEntity(instance, cache)
}

/**
 * Tear down every cached instance `filter` matches, whatever holds remain (Schema.destroy, test
 * cleanup). Returns them.
 */
export function evictEntities<T extends ActorBacked>(cache: EntityCache<T>, filter: (instance: T) => boolean): T[] {
  const evicted = cache.instances(filter)
  for (const instance of evicted) teardownEntity(instance, cache)
  return evicted
}

/**
 * Stop and drop every cached entity of every class, whoever holds it (client.stop()). Reaches the
 * caches through EntityCache.all, so callers needn't import the entity classes.
 */
export function evictAllEntities(): void {
  for (const cache of EntityCache.all) evictEntities(cache, () => true)
}

/**
 * Delete an entity's rows. By default it leaves the cache first, so no lookup returns it meanwhile;
 * with `leaveCache: 'after'` it stays cached until the rows are gone, so a lookup that read a row
 * before the delete finds it instead of building a new instance. Its actor runs until the rows are
 * gone (its watches see the delete). A `deleteRows` failure is recorded on the actor
 * (`destroyError`) and rethrown; the entity is torn down either way.
 */
export async function destroyEntity<T extends ActorBacked>(
  instance: T,
  cache: EntityCache<T>,
  deleteRows: () => Promise<void>,
  options: { leaveCache?: 'before' | 'after' } = {},
): Promise<void> {
  const actor = instance.getService() as Actor
  if (options.leaveCache !== 'after') cache.remove(instance)
  actor.send?.({ type: 'destroyStarted' })
  try {
    await deleteRows()
  } catch (error) {
    actor.send?.({ type: 'destroyError', error })
    throw error
  } finally {
    teardownEntity(instance, cache)
  }
}

/**
 * Make `parent` hold `child` until the parent is torn down or `releaseChildHold` is called. One hold
 * per pair; false when the child isn't cached or the parent was torn down. Schema holds its Models,
 * Model its ModelProperties, Item its ItemProperties.
 */
export function holdChild<C extends ActorBacked>(parent: ActorBacked, child: C, childCache: EntityCache<C>): boolean {
  const lifecycle = lifecycleOf(parent)
  if (lifecycle.tornDown) return false
  const key = child.getService()
  if (lifecycle.children.has(key)) return true
  if (!childCache.holdInstance(child)) return false
  lifecycle.children.set(key, (options) => releaseEntity(child, childCache, options))
  return true
}

export function releaseChildHold(parent: ActorBacked, child: ActorBacked): void {
  const children = lifecycleOf(parent).children
  const key = child.getService()
  const release = children.get(key)
  if (!release) return
  children.delete(key)
  release()
}

/** The actors of the children `parent` holds. */
export function heldChildActors(parent: ActorBacked): object[] {
  return [...lifecycleOf(parent).children.keys()]
}
