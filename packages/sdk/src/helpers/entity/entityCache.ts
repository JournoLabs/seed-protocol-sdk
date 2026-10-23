/** Anything with an actor: every entity class, and its reactive proxy (same actor). */
export interface ActorBacked {
  getService(): object
}

/**
 * A cached entity instance. One entry per instance, stored under every key it has: the first
 * key is its id, the rest are aliases (a name, a uid). The entry owns its keys, so removing it
 * removes all of them, including aliases that went stale on a rename.
 */
export interface EntityEntry<T> {
  instance: T
  refCount: number
  keys: Set<string>
}

/**
 * The cache behind an entity class (ADR 0014). `peek` takes no hold; `hold`, `add({ hold: true })`
 * and `holdInstance` take one each, and `release` gives one back. Entries are found by key or by
 * actor, so a raw instance and its proxy find the same entry.
 */
export class EntityCache<T extends ActorBacked> {
  /** Every cache made, one per entity class; client.stop() evicts them all (evictAllEntities). */
  static readonly all = new Set<EntityCache<ActorBacked>>()

  private readonly byKey = new Map<string, EntityEntry<T>>()
  private readonly byActor = new WeakMap<object, EntityEntry<T>>()

  constructor() {
    EntityCache.all.add(this as unknown as EntityCache<ActorBacked>)
  }

  /** Cache `instance` under `keys` (empty and duplicate keys are skipped). Returns its entry. */
  add(instance: T, keys: Array<string | null | undefined>, options: { hold: boolean }): EntityEntry<T> {
    const existing = this.entryOf(instance)
    if (existing) {
      if (options.hold) existing.refCount += 1
      for (const key of keys) if (key) this.addKey(instance, key)
      return existing
    }
    const entry: EntityEntry<T> = {
      instance,
      refCount: options.hold ? 1 : 0,
      keys: new Set(),
    }
    this.byActor.set(instance.getService(), entry)
    for (const key of keys) if (key) this.addKey(instance, key)
    return entry
  }

  /** The cached instance under `key`, without taking a hold. */
  peek(key: string | null | undefined): T | undefined {
    return key ? this.byKey.get(key)?.instance : undefined
  }

  /** The cached instance under `key`, taking a hold the caller releases with `release`. */
  hold(key: string | null | undefined): T | undefined {
    const entry = key ? this.byKey.get(key) : undefined
    if (!entry) return undefined
    entry.refCount += 1
    return entry.instance
  }

  /** Take a hold on a cached instance. False when it isn't cached (unloaded, evicted). */
  holdInstance(instance: T): boolean {
    const entry = this.entryOf(instance)
    if (!entry) return false
    entry.refCount += 1
    return true
  }

  /**
   * Give back one hold. True when the instance should be torn down: its last hold went, or it
   * isn't cached at all (evicted while the caller held it).
   */
  release(instance: T): boolean {
    const entry = this.entryOf(instance)
    if (!entry) return true
    entry.refCount -= 1
    return entry.refCount <= 0
  }

  entryOf(instance: T): EntityEntry<T> | undefined {
    return this.byActor.get(instance.getService())
  }

  has(instance: T): boolean {
    return this.entryOf(instance) !== undefined
  }

  /**
   * Store the instance under one more key. A key held by another instance moves to this one:
   * the newest instance for a name or uid wins.
   */
  addKey(instance: T, key: string | null | undefined): void {
    const entry = this.entryOf(instance)
    if (!entry || !key) return
    const previous = this.byKey.get(key)
    if (previous === entry) return
    previous?.keys.delete(key)
    this.byKey.set(key, entry)
    entry.keys.add(key)
  }

  removeKey(instance: T, key: string): void {
    const entry = this.entryOf(instance)
    if (!entry || !entry.keys.has(key)) return
    entry.keys.delete(key)
    if (this.byKey.get(key) === entry) this.byKey.delete(key)
  }

  /** Replace every key of the instance (a rename, an id that changed). */
  setKeys(instance: T, keys: Array<string | null | undefined>): void {
    const entry = this.entryOf(instance)
    if (!entry) return
    const next = new Set(keys.filter((key): key is string => !!key))
    for (const key of [...entry.keys]) if (!next.has(key)) this.removeKey(instance, key)
    for (const key of next) this.addKey(instance, key)
  }

  keysOf(instance: T): string[] {
    return [...(this.entryOf(instance)?.keys ?? [])]
  }

  /** Drop the instance under all its keys. Teardown (entityLifecycle) also releases its children. */
  remove(instance: T): EntityEntry<T> | undefined {
    const entry = this.entryOf(instance)
    if (!entry) return undefined
    for (const key of entry.keys) {
      if (this.byKey.get(key) === entry) this.byKey.delete(key)
    }
    entry.keys.clear()
    this.byActor.delete(instance.getService())
    return entry
  }

  /** Every cached instance once, optionally filtered. */
  instances(filter?: (instance: T) => boolean): T[] {
    const seen = new Set<EntityEntry<T>>()
    const result: T[] = []
    for (const entry of this.byKey.values()) {
      if (seen.has(entry)) continue
      seen.add(entry)
      if (!filter || filter(entry.instance)) result.push(entry.instance)
    }
    return result
  }

  get size(): number {
    return this.instances().length
  }
}

/**
 * Evictions and destroys, by scope (`schema:<name>`, `model:<id>`). Work that reads a row and then
 * creates an instance from it (a lookup by id) can't be cancelled by stopping actors: capture
 * `evictionLog.now()` before the read, and skip creating when `evictedSince(scopes, then)`. A scope
 * also counts as evicted while its destroy runs, since its rows still exist until the delete commits.
 */
export const evictionLog = {
  generation: 0,
  last: new Map<string, number>(),
  running: new Map<string, number>(),

  now(): number {
    return this.generation
  },

  /** Record an eviction of these scopes. Call the returned function once a destroy's rows are gone. */
  evict(scopes: string[]): () => void {
    this.generation += 1
    for (const scope of scopes) {
      this.last.set(scope, this.generation)
      this.running.set(scope, (this.running.get(scope) ?? 0) + 1)
    }
    let finished = false
    return () => {
      if (finished) return
      finished = true
      // Work that read a row during the destroy and checks after it must still see the eviction
      this.generation += 1
      for (const scope of scopes) {
        this.last.set(scope, this.generation)
        const remaining = (this.running.get(scope) ?? 1) - 1
        if (remaining > 0) this.running.set(scope, remaining)
        else this.running.delete(scope)
      }
    }
  },

  /** True when a scope is being destroyed, or was evicted after `since`. */
  evictedSince(scopes: Array<string | null | undefined>, since: number): boolean {
    for (const scope of scopes) {
      if (!scope) continue
      if (this.running.has(scope)) return true
      if (this.generation !== since && (this.last.get(scope) ?? 0) > since) return true
    }
    return false
  },
}
