# Proxy-Based Reactive Architecture for Schema and ModelProperty

## Overview

This document outlines an architecture that uses JavaScript Proxies to handle getters and setters for `Schema` and `ModelProperty` classes, enabling automatic React re-renders when property values change.

## Current Architecture

Currently, both `Schema` and `ModelProperty` classes:
1. Use `Object.defineProperty` to create getters/setters for each tracked property
2. Getters read from `_service.getSnapshot().context`
3. Setters send `updateContext` events to the actor service
4. React hooks subscribe to the actor service to detect changes

## Proposed Proxy Architecture

### Core Concept

Instead of using `Object.defineProperty` for each property, we'll return a Proxy from the `create()` static method that intercepts all property access and assignment operations.

### Architecture Components

#### 1. Proxy Factory Function

Create a reusable proxy factory that can be used by both `Schema` and `ModelProperty`:

```typescript
type TrackedPropertyKeys = string[]
type ActorService = ActorRefFrom<any>

interface ProxyConfig<T> {
  instance: T
  service: ActorService
  trackedProperties: TrackedPropertyKeys
  getContext: () => any
  sendUpdate: (prop: string, value: any) => void
}

function createReactiveProxy<T extends object>(config: ProxyConfig<T>): T {
  const { instance, service, trackedProperties, getContext, sendUpdate } = config
  
  return new Proxy(instance, {
    get(target, prop: string | symbol) {
      // Handle special properties that should not be proxied
      if (prop === '_service') {
        return Reflect.get(target, prop)
      }
      
      // If it's a tracked property, read from actor context
      if (typeof prop === 'string' && trackedProperties.includes(prop)) {
        const context = getContext()
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
      if (typeof prop === 'string' && trackedProperties.includes(prop)) {
        sendUpdate(prop, value)
        return true // Indicate success
      }
      
      // For non-tracked properties, use Reflect
      return Reflect.set(target, prop, value)
    },
    
    has(target, prop: string | symbol) {
      // Check if property exists in context or on target
      if (typeof prop === 'string' && trackedProperties.includes(prop)) {
        const context = getContext()
        return prop in context
      }
      return Reflect.has(target, prop)
    },
    
    ownKeys(target) {
      // Return keys from both context and target
      const context = getContext()
      const contextKeys = trackedProperties.filter(key => key in context)
      const targetKeys = Reflect.ownKeys(target)
      return [...new Set([...contextKeys, ...targetKeys])]
    },
    
    getOwnPropertyDescriptor(target, prop: string | symbol) {
      if (typeof prop === 'string' && trackedProperties.includes(prop)) {
        const context = getContext()
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
}
```

#### 2. Schema Class Modifications

```typescript
export class Schema {
  // ... existing static caches and properties ...
  
  // Define tracked properties (same as current SchemaFileFormatKeys + MetadataKeys)
  private static readonly TRACKED_PROPERTIES = [
    '$schema',
    'version',
    'metadata',
    'enums',
    'migrations',
    'models',
    'name',        // metadata.name
    'createdAt',   // metadata.createdAt
    'updatedAt',   // metadata.updatedAt
  ] as const
  
  constructor(schemaName: string) {
    // ... existing constructor code ...
    // REMOVE: All Object.defineProperty calls
    // The Proxy will handle these instead
  }
  
  static create(schemaName: string): Schema {
    // ... existing cache logic ...
    
    const instance = new this(schemaName)
    
    // Wrap instance in Proxy
    return createReactiveProxy<Schema>({
      instance,
      service: instance._service,
      trackedProperties: Schema.TRACKED_PROPERTIES as any,
      getContext: () => {
        // Handle special cases like metadata.name, models array conversion
        const context = instance._getSnapshotContext()
        return {
          ...context,
          // Flatten metadata properties to top level for convenience
          name: context.metadata?.name,
          createdAt: context.metadata?.createdAt,
          updatedAt: context.metadata?.updatedAt,
          // Convert models object to array
          models: Object.entries(context.models || {}).map(([name, data]) => ({
            name,
            ...data,
          })),
        }
      },
      sendUpdate: (prop: string, value: any) => {
        // Handle special property updates
        if (prop === 'name') {
          // Update both metadata.name and schemaName
          const context = instance._getSnapshotContext()
          const oldName = context.metadata?.name || context.schemaName
          const newName = value as string
          
          if (oldName !== newName) {
            instance._service.send({
              type: 'updateContext',
              schemaName: newName,
              metadata: {
                ...(context.metadata || {}),
                name: newName,
                updatedAt: new Date().toISOString(),
              },
            })
            instance._service.send({ type: 'markAsDraft', propertyKey: 'schema:name' })
            instance._saveDraftToDb(oldName, newName).catch(() => {})
            instance._updateClientContext(newName, oldName)
          }
        } else if (prop === 'models') {
          // Convert array back to object
          let modelsObject: { [key: string]: any }
          if (Array.isArray(value)) {
            modelsObject = {}
            for (const model of value) {
              if (model && typeof model === 'object' && 'name' in model) {
                const { name, ...modelData } = model
                modelsObject[name] = modelData
              }
            }
          } else {
            modelsObject = value || {}
          }
          instance._service.send({
            type: 'updateContext',
            models: modelsObject,
          })
        } else if (prop === 'createdAt' || prop === 'updatedAt') {
          // Update metadata object
          const context = instance._getSnapshotContext()
          instance._service.send({
            type: 'updateContext',
            metadata: {
              ...(context.metadata || {}),
              [prop]: value,
              updatedAt: new Date().toISOString(),
            },
          })
          instance._updateClientContext().catch(() => {})
        } else {
          // Standard property update
          instance._service.send({
            type: 'updateContext',
            [prop]: value,
          })
        }
      },
    })
  }
  
  // Keep existing methods unchanged
  getService(): SchemaService { ... }
  private _getSnapshotContext(): SchemaMachineContext { ... }
  // ... rest of methods ...
}
```

#### 3. ModelProperty Class Modifications

```typescript
export class ModelProperty {
  // ... existing static cache ...
  
  // Define tracked properties
  private static readonly TRACKED_PROPERTIES = [
    'id',
    'name',
    'dataType',
    'ref',
    'modelId',
    'refModelId',
    'refValueType',
    'storageType',
    'localStorageDir',
    'filenameSuffix',
    'modelName',
    'refModelName',
  ] as const
  
  constructor(property: Static<typeof TProperty>) {
    // ... existing constructor code ...
    // REMOVE: All Object.defineProperty calls
  }
  
  static create(property: Static<typeof TProperty>): ModelProperty {
    // ... existing cache logic ...
    
    const instance = new this(property)
    
    // Wrap instance in Proxy
    return createReactiveProxy<ModelProperty>({
      instance,
      service: instance._service,
      trackedProperties: ModelProperty.TRACKED_PROPERTIES as any,
      getContext: () => instance._getSnapshotContext(),
      sendUpdate: (prop: string, value: any) => {
        instance._service.send({
          type: 'updateContext',
          [prop]: value,
        })
      },
    })
  }
  
  // Keep existing methods unchanged
  getService(): ModelPropertyService { ... }
  private _getSnapshotContext(): ModelPropertyMachineContext { ... }
  // ... rest of methods ...
}
```

### 4. React Integration (No Changes Needed)

The existing React hooks will continue to work because:
- They subscribe to the actor service: `instance.getService().subscribe(...)`
- When a property is set via the Proxy, it sends an event to the actor
- The actor updates its context
- The subscription callback fires
- React re-renders

The Proxy is transparent to the React hooks - they still get the same instance and can call `getService()` on it.

## Benefits

1. **Cleaner Code**: No need to manually define getters/setters for each property
2. **Type Safety**: TypeScript can still infer types correctly
3. **Flexibility**: Easy to add/remove tracked properties by updating the array
4. **Consistency**: Same pattern for both Schema and ModelProperty
5. **Backward Compatibility**: Existing code using these classes continues to work
6. **Automatic React Re-renders**: No changes needed to React hooks

## Implementation Considerations

### 1. Special Property Handling

Some properties need special handling:
- `metadata.name` → flattened to `name` on the proxy
- `models` → converted between object (context) and array (proxy interface)
- `_service` → must not be proxied (needed for React hooks)

### 2. Method Calls

Methods on the class (like `save()`, `validate()`, `unload()`) should work normally via `Reflect.get()`.

### 3. Cache Consistency

The static `create()` methods cache instances. The Proxy should wrap the instance before caching, so all consumers get the same proxied instance.

### 5. Type Safety

TypeScript might need some type assertions or helper types to understand that the Proxy returns the same type as the class:

```typescript
// Helper type to maintain type safety
type Proxied<T> = T & {
  // Proxy doesn't change the type, just the behavior
}

static create(...): Proxied<Schema> {
  // ...
}
```

## Example Usage

```typescript
// In a React component
const { schema } = useSchema('mySchema')

// Setting a property automatically:
// 1. Proxy intercepts the set
// 2. Sends updateContext event to actor
// 3. Actor updates context
// 4. React hook subscription fires
// 5. Component re-renders
schema.name = 'New Name'
schema.version = 2

// Reading a property:
// 1. Proxy intercepts the get
// 2. Reads from actor snapshot context
// 3. Returns current value
console.log(schema.name) // 'New Name'
```

## Migration Path

1. Create the `createReactiveProxy` utility function
2. Update `Schema.create()` to return a Proxy
3. Update `ModelProperty.create()` to return a Proxy
4. Remove all `Object.defineProperty` calls from constructors
5. Test that React hooks still work correctly
6. Test that all property getters/setters work as expected
7. Test special cases (metadata.name, models array conversion)

## Potential Issues and Solutions

### Issue: TypeScript Type Inference

**Problem**: TypeScript might not understand that the Proxy maintains the same type.

**Solution**: Use type assertions or helper types to maintain type safety.

### Issue: Property Enumeration

**Problem**: `Object.keys()` or `for...in` loops might not see proxied properties.

**Solution**: Implement `ownKeys` trap in the Proxy to return both context keys and target keys.

### Issue: Property Descriptors

**Problem**: Some code might check property descriptors.

**Solution**: Implement `getOwnPropertyDescriptor` trap to return appropriate descriptors for tracked properties.

### Issue: Performance

**Problem**: Proxy adds a small overhead for every property access.

**Solution**: This is negligible for typical use cases. The actor subscription mechanism already handles the heavy lifting.

## Testing Strategy

1. **Unit Tests**: Test that Proxy correctly intercepts gets/sets
2. **Integration Tests**: Test that React hooks still trigger re-renders
3. **E2E Tests**: Test that setting properties in React components works
4. **Type Tests**: Ensure TypeScript types are preserved

## Future Enhancements

1. **Computed Properties**: Could add computed properties that derive from context
2. **Validation Hooks**: Could intercept sets and validate before updating
3. **Change Tracking**: Could track which properties changed for debugging
4. **Undo/Redo**: Could maintain history of changes

