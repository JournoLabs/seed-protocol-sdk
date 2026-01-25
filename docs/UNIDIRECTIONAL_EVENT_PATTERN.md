# Unidirectional Event Pattern Design

## Overview

This document evaluates a unidirectional event pattern where child entities can send events to their parent entities, but parents never update their children in response. This maintains the architectural principle from `MODEL_EDIT_FLOW_REFACTORING.md` while enabling parent entities to react to child changes.

## Core Principle

**Child entities can notify parents, but parents do not update children.**

- ✅ **ModelProperty → Model**: ModelProperty can send events to Model
- ✅ **Model → Schema**: Model can send events to Schema
- ❌ **Model → ModelProperty**: Model should NOT update ModelProperty instances
- ❌ **Schema → Model**: Schema should NOT update Model instances

## Event Flow Hierarchy

```
ModelProperty (child)
    ↓ events
Model (parent)
    ↓ events
Schema (grandparent)
```

## Use Cases Enabled

### 1. ModelProperty Edit → Model Properties Update & Draft State

**Scenario**: When a user edits a ModelProperty, the Model should:
- Update its `properties` property by reading from ModelProperty instances (read-only)
- Mark itself as draft
- Forward event to Schema

**Flow**:
```
User edits ModelProperty.name →
  ModelProperty sends 'property:edit' event to Model →
    Model receives event →
      Model updates its 'properties' property (read-only, from ModelProperty instances) →
      Model marks itself as draft →
      Model sends 'model:edit' event to Schema →
        Schema marks itself as draft
```

**Benefits**:
- Model's `properties` property stays in sync with actual ModelProperty instances
- Model can react to ModelProperty changes without pushing updates back
- Enables reactive UI updates (e.g., `useModel` hook can return `model.properties`)
- Automatic cascading draft state

### 2. Model Edit → Schema Models Property Update & Draft State

**Scenario**: When a Model changes, Schema should:
- Update its `models` property by reading from Model instances (read-only)
- Mark itself as draft

**Flow**:
```
User edits Model.description →
  Model sends 'model:edit' event to Schema →
    Schema receives event →
      Schema updates its 'models' property (read-only, from Model instance) →
      Schema marks itself as draft
```

**Benefits**:
- Schema's `models` property stays in sync with actual Model instances
- Schema can react to Model changes without pushing updates back
- Enables reactive UI updates (e.g., `useSchema` hook can return `schema.models`)
- `useModels` hook can simply return `schema.models` and automatically re-render

### 3. Cascading Draft State

**Scenario**: Any edit at any level should bubble up to mark all parents as draft.

**Flow**:
```
ModelProperty edit → Model (mark as draft) → Schema (mark as draft)
Model edit → Schema (mark as draft)
```

**Benefits**:
- Consistent draft tracking across the hierarchy
- Parent entities automatically know when children are edited

### 4. Reactive Proxy Pattern for Child Collections

**Scenario**: Both `Model.properties` and `Schema.models` should be reactive via Proxy handlers, enabling automatic React re-renders.

**Flow**:
```
ModelProperty edit →
  Model.properties updated (via Proxy) →
    React component using model.properties re-renders

Model edit →
  Schema.models updated (via Proxy) →
    React component using schema.models re-renders
    useModels hook automatically updates
```

**Benefits**:
- `useModels` can simply return `schema.models` (array of Model instances)
- `useModelProperties` can simply return `model.properties` (object of property definitions)
- No manual subscription management needed
- Proxy handlers automatically trigger re-renders when child collections update

## Event Mechanism: XState Actor Events

**Approach**: Use XState's built-in actor communication via `send()` and subscriptions.

**Implementation Pattern**:
```typescript
// ModelProperty sends event to Model
modelInstance.getService().send({
  type: 'property:edit',
  propertyName: 'title',
  propertyId: propertyId,
})

// Model sends event to Schema
schemaInstance.getService().send({
  type: 'model:edit',
  modelName: 'Post',
  modelId: modelFileId,
})
```

**Benefits**:
- ✅ Type-safe events (via XState type system)
- ✅ Integrated with existing state machines
- ✅ Events are part of actor lifecycle
- ✅ Easy to test (can subscribe to events in tests)
- ✅ No external dependencies
- ✅ Events are scoped to specific actor instances
- ✅ Can use XState's event guards and actions

**Example Implementation**:
```typescript
// In ModelProperty setter
if (this._modelInstance) {
  this._modelInstance.getService().send({
    type: 'property:edit',
    propertyName: this.name,
    propertyId: this.id,
  })
}

// In Model setter
if (this._schemaInstance) {
  this._schemaInstance.getService().send({
    type: 'model:edit',
    modelName: this.modelName,
    modelId: this.id,
  })
}

// In Schema machine
on: {
  'model:edit': {
    actions: [
      assign(({ context, event }) => ({
        ...context,
        _isDraft: true,
        _editedProperties: new Set([
          ...(context._editedProperties || []),
          `model:${event.modelName}`,
        ]),
      })),
      'handleModelEdit', // Updates Schema.models property (read-only)
    ],
  },
}
```

## Implementation Plan

### Phase 1: ModelProperty → Model Events & Properties Update

**File: `src/ModelProperty/ModelProperty.ts`**

1. **Add Model Reference to ModelProperty**:
   ```typescript
   private _modelInstance?: Model
   
   // Set during ModelProperty.create() if model instance provided
   static create(property: Static<typeof TProperty>, modelInstance?: Model) {
     // ... existing code ...
     if (modelInstance) {
       newInstance._modelInstance = modelInstance
       // Register with Model
       modelInstance._registerPropertyInstance(proxiedInstance)
     }
   }
   ```

2. **Send Events on Property Updates**:
   ```typescript
   // In proxy setter (createReactiveProxy sendUpdate)
   sendUpdate: (prop: string, value: any) => {
     newInstance._service.send({
       type: 'updateContext',
       [prop]: value,
     })
     
     // Send event to Model (if model instance exists)
     if (newInstance._modelInstance) {
       newInstance._modelInstance.getService().send({
         type: 'property:edit',
         propertyName: newInstance.name,
         propertyId: newInstance.id,
         modelName: newInstance.modelName,
         propertyKey: prop,
       })
     }
   }
   ```

**File: `src/Model/service/modelMachine.ts`**

3. **Add Event Handler**:
   ```typescript
   on: {
     'property:edit': {
       actions: [
         assign(({ context, event }) => ({
           ...context,
           _isDraft: true,
           _editedProperties: new Set([
             ...(context._editedProperties || []),
             `property:${event.propertyName}`,
           ]),
         })),
         'handlePropertyEdit', // Updates Model.properties property (read-only)
         'forwardToSchema',    // Forwards to Schema
       ],
     },
   }
   ```

4. **Add Action to Update Model.properties**:
   ```typescript
   actions: {
     handlePropertyEdit: ({ context, event, self }) => {
       // Read properties from ModelProperty instances (read-only)
       const modelInstance = Model.getById(context._modelFileId)
       if (modelInstance) {
         // Use existing _buildPropertiesFromInstances method
         const properties = modelInstance._buildPropertiesFromInstances()
         
         // Update Model context (read-only update, doesn't push to ModelProperty)
         self.send({
           type: 'updateContext',
           properties: properties,
         })
       }
     },
     forwardToSchema: ({ context, event, self }) => {
       // Get schema instance from Model instance
       // Send model:edit event to Schema
       const modelInstance = Model.getById(context._modelFileId)
       if (modelInstance?._schemaInstance) {
         modelInstance._schemaInstance.getService().send({
           type: 'model:edit',
           modelName: context.modelName,
           modelId: context._modelFileId,
           propertyKey: 'properties',
         })
       }
     },
   }
   ```

**Key Point**: Model updates its own `properties` property by reading from ModelProperty instances via `_buildPropertiesFromInstances()`, but never sends `updateContext` back to ModelProperty.

### Phase 2: Model → Schema Events & Models Update

**File: `src/Model/Model.ts`**

1. **Add Schema Reference to Model**:
   ```typescript
   // Store schema instance reference (read-only)
   private _schemaInstance?: Schema
   
   // Set during Model.create() if schema instance provided
   static create(..., schemaInstance?: Schema) {
     // ... existing code ...
     if (schemaInstance) {
       newInstance._schemaInstance = schemaInstance
     }
   }
   ```

2. **Send Events on Property Updates**:
   ```typescript
   // In proxy setter for properties, indexes, description, modelName
   if (prop === 'properties' || prop === 'indexes' || prop === 'description' || prop === 'modelName') {
     // ... existing updateContext code ...
     
     // Send event to Schema (if schema instance exists)
     if (newInstance._schemaInstance) {
       newInstance._schemaInstance.getService().send({
         type: 'model:edit',
         modelName: context.modelName,
         modelId: context._modelFileId,
         propertyKey: prop,
       })
     }
   }
   ```

**File: `src/Schema/service/schemaMachine.ts`**

3. **Add Event Handler**:
   ```typescript
   on: {
     'model:edit': {
       actions: [
         assign(({ context, event }) => ({
           ...context,
           _isDraft: true,
           _editedProperties: new Set([
             ...(context._editedProperties || []),
             `model:${event.modelName}`,
           ]),
         })),
         'handleModelEdit', // Updates Schema.models property (read-only)
       ],
     },
   }
   ```

4. **Add Action to Update Schema.models**:
   ```typescript
   actions: {
     handleModelEdit: ({ context, event }) => {
       // Read model data from Model instance (read-only)
       const model = Model.getById(event.modelId)
       if (model && context.models) {
         const updatedModels = { ...context.models }
         updatedModels[model.modelName!] = {
           description: model.description,
           properties: model.properties || {},
           indexes: model.indexes,
         }
         
         // Update Schema context (read-only update, doesn't push to Model)
         // This will trigger Proxy handlers, causing React re-renders
         return {
           ...context,
           models: updatedModels,
         }
       }
       return context
     },
   }
   ```

**Key Point**: Schema updates its own `models` property by reading from Model instance, but never sends `updateContext` back to Model. The Proxy handler will automatically trigger React re-renders.

### Phase 3: Reactive Proxy Pattern

**File: `src/Schema/Schema.ts`**

1. **Ensure Proxy Handlers React to `models` Updates**:
   ```typescript
   // The existing createReactiveProxy should already handle this
   // When Schema.models is updated via updateContext, the Proxy will
   // trigger React re-renders for components using schema.models
   ```

**File: `src/Model/Model.ts`**

2. **Ensure Proxy Handlers React to `properties` Updates**:
   ```typescript
   // The existing Proxy should already handle this
   // When Model.properties is updated via updateContext, the Proxy will
   // trigger React re-renders for components using model.properties
   ```

**File: `src/browser/react/schema.ts`**

3. **Update `useModels` Hook**:
   ```typescript
   export const useModels = (schemaId: string | null | undefined): Model[] => {
     const schema = useSchema(schemaId)
     
     // Simply return schema.models - Proxy will handle re-renders
     return schema?.models || []
   }
   ```

**File: `src/browser/react/model.ts`**

4. **Add `useModelProperties` Hook** (if needed):
   ```typescript
   export const useModelProperties = (model: Model | null | undefined): { [key: string]: any } => {
     // Simply return model.properties - Proxy will handle re-renders
     return model?.properties || {}
   }
   ```

## Event Types

### ModelProperty → Model Events

```typescript
type ModelPropertyEditEvent = {
  type: 'property:edit'
  propertyName: string
  propertyId: number
  modelName: string
  // Optional: what changed
  propertyKey?: 'name' | 'dataType' | 'ref' | 'description' | etc.
}
```

### Model → Schema Events

```typescript
type ModelEditEvent = {
  type: 'model:edit'
  modelName: string
  modelId: string // modelFileId
  // Optional: what changed
  propertyKey?: 'modelName' | 'properties' | 'indexes' | 'description'
}
```

## Property and Model Access Patterns

### Non-Reactive Getters (Convenience Methods)

`item.properties`, `model.properties`, and `schema.models` are **non-reactive convenience getters** that return snapshots at the time of access:

- **`item.properties`**: Returns an array of `ItemProperty` instances from the Item's service context
- **`model.properties`**: Returns an array of `ModelProperty` instances from the Model's service context  
- **`schema.models`**: Returns an array of `Model` instances from the Schema's service context

These getters are **NOT reactive** - they won't trigger React re-renders when child instances change. They're useful for one-time reads or non-React code.

### Reactive Hooks (Recommended for React)

For React components that need reactivity, use the dedicated hooks:

- **`useItemProperties(itemId)`**: Watches the database and returns reactive `ItemProperty[]`
- **`useModelProperties(schemaId, modelName)`**: Watches the database and returns reactive `ModelProperty[]`
- **`useModels(schemaId)`**: Watches the database and returns reactive `Model[]`
- **`useItemProperty(itemId, propertyName)`**: Watches a specific `ItemProperty` for value/context changes

These hooks use `useLiveQuery` to watch database tables directly, providing automatic re-renders when data changes.

### Benefits

- **Clear Separation**: Non-reactive getters for convenience, reactive hooks for React components
- **Performance**: Hooks only subscribe when needed, getters are lightweight snapshots
- **Type Safety**: All methods maintain type safety
- **Simplicity**: Use hooks in React, getters elsewhere

## Benefits of This Pattern

1. **Unidirectional Flow**: Events flow child → parent, never parent → child
2. **No Update Loops**: Parents never push updates back to children
3. **Reactive Updates**: Parents can react to child changes without tight coupling
4. **Draft State Management**: Automatic cascading draft state
5. **Type Safety**: XState events are type-checked
6. **Testability**: Easy to test with XState subscriptions

## Potential Issues & Solutions

### Issue 1: Schema Needs Model Instance Reference

**Problem**: Model needs to know its Schema instance to send events.

**Solution**: 
- Store Schema instance reference in Model (set during `Model.create()`)
- This is already done when `registerWithSchema: true`
- Make it explicit and always store the reference

### Issue 2: Multiple Schema Instances

**Problem**: If multiple Schema instances exist for same schema, which one receives the event?

**Solution**:
- Schema instances are cached by `schemaFileId` or `schemaName`
- Model stores reference to the Schema instance it was created with
- Only that instance receives events (correct behavior)

### Issue 3: Event Ordering

**Problem**: If ModelProperty sends event to Model, and Model forwards to Schema, could there be race conditions?

**Solution**:
- XState events are processed synchronously within the same actor
- Forwarding happens in the same action, so order is guaranteed
- If async operations are needed, use XState's async actions

### Issue 4: Performance

**Problem**: Sending events on every property update could be expensive.

**Solution**:
- Batch events (debounce/throttle)
- Only send events for tracked properties
- Use XState's event guards to filter unnecessary events

## Migration Strategy

1. **Phase 1**: Add ModelProperty → Model events (non-breaking)
   - Add event handlers to Model machine
   - Send events from ModelProperty setters
   - Update Model.properties on property:edit events
   - Test with existing code

2. **Phase 2**: Add Model → Schema events (non-breaking)
   - Add event handlers to Schema machine
   - Send events from Model setters
   - Update Schema.models on model:edit events
   - Forward property:edit events from Model to Schema

3. **Phase 3**: Update React hooks (non-breaking)
   - Update `useModels` to return `schema.models` directly
   - Add `useModelProperties` hook if needed
   - Test React re-renders work correctly

4. **Phase 4**: Remove old notification methods (breaking)
   - Remove `_notifySchemaOfModelChange()` and `_notifySchemaOfNameChange()`
   - Update any code that relied on them

## Testing Strategy

1. **Unit Tests**: Test event handlers in isolation
2. **Integration Tests**: Test event flow ModelProperty → Model → Schema
3. **E2E Tests**: Test that Schema draft state updates correctly
4. **Performance Tests**: Ensure events don't cause performance issues

## Conclusion

The unidirectional event pattern (child → parent) is a good fit for this architecture because:

1. ✅ Maintains the principle that parents never update children
2. ✅ Enables reactive updates without tight coupling
3. ✅ Uses XState's built-in event system (type-safe, testable)
4. ✅ Enables use cases like automatic draft state management
5. ✅ Allows Schema to stay in sync with Model changes (read-only)
6. ✅ Allows Model to stay in sync with ModelProperty changes (read-only)
7. ✅ Consistent pattern for both `Model.properties` and `Schema.models`
8. ✅ Automatic React re-renders via Proxy handlers
9. ✅ Simple React hooks: `useModels` returns `schema.models`, `useModelProperties` returns `model.properties`

**Recommendation**: Proceed with XState actor events. The same pattern applies to both Model.properties and Schema.models, ensuring consistency across the codebase.

