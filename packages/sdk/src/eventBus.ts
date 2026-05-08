type EventKey = string | symbol
type Listener = (...args: any[]) => void

class SeedEventEmitter {
  private listeners = new Map<EventKey, Set<Listener>>()

  on(event: EventKey, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(event, set)
    return this
  }

  addListener(event: EventKey, listener: Listener): this {
    return this.on(event, listener)
  }

  once(event: EventKey, listener: Listener): this {
    const wrapped: Listener = (...args: any[]) => {
      this.off(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: EventKey, listener: Listener): this {
    const set = this.listeners.get(event)
    if (!set) return this
    set.delete(listener)
    if (set.size === 0) this.listeners.delete(event)
    return this
  }

  removeListener(event: EventKey, listener: Listener): this {
    return this.off(event, listener)
  }

  removeAllListeners(event?: EventKey): this {
    if (typeof event === 'undefined') {
      this.listeners.clear()
      return this
    }
    this.listeners.delete(event)
    return this
  }

  emit(event: EventKey, ...args: any[]): boolean {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return false
    for (const listener of [...set]) {
      listener(...args)
    }
    return true
  }
}

const eventEmitter = new SeedEventEmitter()

export { eventEmitter }
