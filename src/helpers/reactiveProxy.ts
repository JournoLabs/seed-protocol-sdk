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
  const { instance, trackedProperties, getContext, sendUpdate } = config
  
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
      
      // For non-tracked properties, use Reflect
      return Reflect.set(target, prop, value)
    },
    
    has(target, prop: string | symbol) {
      // Check if property exists in context or on target
      if (typeof prop === 'string' && trackedPropsSet.has(prop)) {
        const context = getContext(instance)
        return prop in context
      }
      return Reflect.has(target, prop)
    },
    
    ownKeys(target) {
      // Only return keys that actually exist on the target object
      // This is required when the target is non-extensible (e.g., frozen by Immer)
      // Tracked properties are virtual (read from context), so we don't include them here
      // They're accessible via the get trap, but don't appear in ownKeys
      return Reflect.ownKeys(target)
    },
    
    getOwnPropertyDescriptor(target, prop: string | symbol) {
      if (typeof prop === 'string' && trackedPropsSet.has(prop)) {
        const context = getContext(instance)
        if (prop in context) {
          return {
            enumerable: true,
            configurable: true,
            value: context[prop],
            writable: true,
          }
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    }
  })
  
  // Force TypeScript to recognize all methods and properties are preserved
  // The Proxy implementation preserves all methods via Reflect.get, so this is safe
  return proxy as unknown as Proxied<T>
}

