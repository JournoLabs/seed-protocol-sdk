/**
 * The lookups the entity helpers need from a per-instance state store. A `WeakMap` keyed by
 * instance satisfies it, but use `ActorKeyedState`: see there for why.
 */
export interface InstanceStateStore<T extends object, S> {
  get(instance: T): S | undefined
  set(instance: T, state: S): unknown
  delete(instance: T): boolean
  has(instance: T): boolean
}

/**
 * Per-instance state for an entity (liveQuery subscriptions and the like), keyed by the entity's
 * actor. An entity's raw instance and its reactive proxy are different objects that share one
 * actor. State set from the constructor (`this` = raw instance) must be found again from methods
 * called on the proxy (`this` = proxy), so a WeakMap keyed by the instance misses there.
 *
 * `getService()` must return the actor before the first `set`.
 */
export class ActorKeyedState<T extends { getService(): object }, S> implements InstanceStateStore<T, S> {
  private readonly states = new WeakMap<object, S>()

  get(instance: T): S | undefined {
    return this.states.get(instance.getService())
  }

  set(instance: T, state: S): this {
    this.states.set(instance.getService(), state)
    return this
  }

  delete(instance: T): boolean {
    return this.states.delete(instance.getService())
  }

  has(instance: T): boolean {
    return this.states.has(instance.getService())
  }
}
