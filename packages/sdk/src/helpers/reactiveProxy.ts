/**
 * Configuration for creating a reactive proxy
 */
interface ProxyConfig<T> {
  /** The instance to wrap in a proxy */
  instance: T
  /** The actor service that manages state */
  service: any
  /** Array of property names that should be tracked (read from/written to actor context) */
  trackedProperties: readonly string[]
  /** Function to get the current context from the actor */
  getContext: (instance: T) => any
  /** Function to send an update to the actor when a property is set */
  sendUpdate: (instance: T, prop: string, value: any) => void
  /**
   * Names that aren't tracked fields but read and write through the proxy: Item's model properties
   * (`item.title`), Model's `name` alias. Checked before the instance's own members. Return
   * undefined for names it doesn't handle.
   */
  resolve?: (instance: T, prop: string) => VirtualProperty | undefined
  /** The names `resolve` handles right now, so they enumerate (`Object.keys`, spread). */
  virtualKeys?: (instance: T) => string[]
  /**
   * Called before an assignment to a name that is neither tracked nor resolved, before it reaches
   * the instance. Throw to refuse it (read-only names).
   */
  onSet?: (instance: T, prop: string, value: unknown) => void
}

/** A name `resolve` routes through the proxy. Without `set`, assigning it throws. */
export interface VirtualProperty {
  get: () => unknown
  set?: (value: unknown) => void
}

/**
 * Type helper that explicitly preserves all methods and properties when wrapping in a Proxy.
 * 
 * TypeScript's Proxy type doesn't automatically preserve method signatures, so we need
 * to use this helper type to ensure all methods are recognized by TypeScript.
 * 
 * This type uses a mapped type to explicitly preserve all properties and methods from T.
 */
export type Proxied<T> = {
  [K in keyof T]: T[K]
} & T

export type InventedPropertyDescriptor = {
  value: unknown
  writable?: boolean
}

/**
 * Proxy [[GetOwnProperty]] that stays compatible with the target.
 * Never overrides an own descriptor, never invents on a non-extensible target,
 * and never promotes a prototype accessor to an own descriptor.
 */
export function getInvariantSafePropertyDescriptor(
  target: object,
  prop: string | symbol,
  invent?: InventedPropertyDescriptor,
): PropertyDescriptor | undefined {
  const own = Reflect.getOwnPropertyDescriptor(target, prop)
  if (own) return own
  if (!invent) return undefined
  if (!Object.isExtensible(target)) return undefined
  return {
    enumerable: true,
    configurable: true,
    value: invent.value,
    writable: invent.writable ?? true,
  }
}

/**
 * Creates a reactive Proxy that intercepts property access and assignment
 * to read from and write to an actor service's context.
 * 
 * This enables automatic React re-renders when properties change, as the
 * React hooks subscribe to the actor service which gets updated when properties
 * are set via the proxy.
 * 
 * @param config Configuration object
 * @returns A proxied instance that behaves like the original but with reactive properties
 * 
 * @note TypeScript's Proxy type doesn't automatically preserve method signatures,
 * so we use Proxied<T> to ensure all methods and properties are recognized.
 * The Proxy implementation preserves all methods via Reflect.get, so this is safe.
 */
export function createReactiveProxy<T extends object>(config: ProxyConfig<T>): Proxied<T> {
  const { instance, trackedProperties, getContext, sendUpdate, resolve, virtualKeys, onSet } = config
  
  // Convert readonly array to regular array for includes() checks
  const trackedPropsSet = new Set(trackedProperties)
  
  // Create the proxy - TypeScript needs explicit type assertion to preserve all methods
  // The Proxy preserves all methods via Reflect.get, so we assert it maintains type T
  // Using 'as unknown as T' forces TypeScript to recognize all methods and properties
  const proxy = new Proxy(instance, {
    get(target, prop: string | symbol) {
      // Handle special properties that should not be proxied
      // These need direct access to the underlying instance
      if (prop === '_service') {
        return Reflect.get(target, prop)
      }
      
      // If it's a tracked property, read from actor context
      if (typeof prop === 'string' && trackedPropsSet.has(prop)) {
        const context = getContext(instance)
        return context[prop]
      }

      const virtual = typeof prop === 'string' ? resolve?.(instance, prop) : undefined
      if (virtual) return virtual.get()
      
      // For methods and non-tracked properties, use Reflect
      return Reflect.get(target, prop)
    },
    
    set(target, prop: string | symbol, value: any) {
      // Handle special properties
      if (prop === '_service') {
        return Reflect.set(target, prop, value)
      }
      
      // If it's a tracked property, send update to actor
      if (typeof prop === 'string' && trackedPropsSet.has(prop)) {
        sendUpdate(instance, prop, value)
        return true // Indicate success
      }
      
      if (typeof prop === 'string') {
        const virtual = resolve?.(instance, prop)
        if (virtual) {
          if (!virtual.set) throw new TypeError(`Cannot set ${prop}: it is read-only.`)
          virtual.set(value)
          return true
        }
        onSet?.(instance, prop, value)
      }
      return Reflect.set(target, prop, value)
    },
    
    has(target, prop: string | symbol) {
      // Check if property exists in context or on target
      if (typeof prop === 'string' && trackedPropsSet.has(prop)) {
        const context = getContext(instance)
        return prop in context
      }
      if (typeof prop === 'string' && resolve?.(instance, prop)) return true
      return Reflect.has(target, prop)
    },
    
    ownKeys(target) {
      // Tracked properties are virtual (read from context), so we don't include them here.
      // They're accessible via the get trap, but don't appear in ownKeys. Resolved names do, when
      // the target is extensible (a non-extensible one, e.g. frozen by Immer, can't report them).
      const keys = Reflect.ownKeys(target)
      if (!virtualKeys || !Object.isExtensible(target)) return keys
      const extra = virtualKeys(instance).filter((key) => !keys.includes(key))
      return extra.length > 0 ? [...keys, ...extra] : keys
    },
    
    getOwnPropertyDescriptor(target, prop: string | symbol) {
      let invent: InventedPropertyDescriptor | undefined
      if (typeof prop === 'string' && trackedPropsSet.has(prop)) {
        const context = getContext(instance)
        if (prop in context) {
          invent = { value: context[prop] }
        }
      } else if (typeof prop === 'string') {
        const virtual = resolve?.(instance, prop)
        if (virtual) invent = { value: virtual.get(), writable: !!virtual.set }
      }
      return getInvariantSafePropertyDescriptor(target, prop, invent)
    }
  })
  
  // Force TypeScript to recognize all methods and properties are preserved
  // The Proxy implementation preserves all methods via Reflect.get, so this is safe
  return proxy as unknown as Proxied<T>
}

