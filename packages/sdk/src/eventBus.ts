type EventKey = string | symbol
type Listener = (...args: any[]) => void

/**
 * Request events the SDK used to handle and no longer listens for, with what to do instead.
 * Emitting one with no listener warns once outside production, since it now does nothing.
 */
const REMOVED_REQUEST_EVENTS = new Map<EventKey, string>([
  ['syncDbWithEas', 'call client.syncFromEas() instead'],
  ['fs.downloadAll.request', "files are downloaded after each sync; call client.syncFromEas() to sync"],
])
const warnedRemovedEvents = new Set<EventKey>()

const isProduction = (): boolean =>
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === 'production'

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

  /**
   * Calls every listener. A listener that throws is logged and skipped: the others still
   * run, and the error never reaches the SDK code that emitted the event (which may be
   * midway through a save).
   */
  emit(event: EventKey, ...args: any[]): boolean {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) {
      const instead = REMOVED_REQUEST_EVENTS.get(event)
      if (instead && !warnedRemovedEvents.has(event) && !isProduction()) {
        warnedRemovedEvents.add(event)
        console.warn(`[seed] Nothing handles the "${String(event)}" event any more, so emitting it does nothing: ${instead}.`)
      }
      return false
    }
    for (const listener of [...set]) {
      try {
        listener(...args)
      } catch (error) {
        console.error(`[seed] listener for "${String(event)}" threw:`, error)
      }
    }
    return true
  }
}

const eventEmitter = new SeedEventEmitter()

export { eventEmitter }
