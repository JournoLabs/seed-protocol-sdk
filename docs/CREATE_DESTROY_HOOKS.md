# Create and Destroy Hooks

The SDK provides a consistent set of React hooks for creating and destroying entity instances (Schema, Model, ModelProperty, Item, ItemProperty). Each hook exposes **loading state**, **error state**, and optional **resetError**, so SDK users can create and destroy entities without manually tracking loading, handling errors, or cleaning up.

## Return shape

All create and destroy hooks follow the same pattern:

**Create hooks** return:

- `create` – function to create an entity (signature varies by entity)
- `isLoading` – `true` while the create operation is in progress
- `error` – `Error | null`; set when the operation fails
- `resetError` – call to clear `error` (e.g. when dismissing UI)

**Destroy hooks** return:

- `destroy` – function that accepts the entity instance and calls `instance.destroy()` (removes from DB where applicable and unloads). `useDeleteItem` names this `deleteItem`.
- `isLoading` – `true` from the moment `destroy()` is called until its promise settles
- `error` – `Error | null`; set when `instance.destroy()` throws or records a `_destroyError` on the instance's service
- `resetError` – call to clear `error`

Destroy hooks track `isLoading` and `error` in hook-local state. The instance's service doesn't record destroy progress, and `destroy()` stops the service, often within a few microtasks, which is too soon for an effect to subscribe. Each hook sets `isLoading` when `destroy()` is called and clears it when the promise settles. Because `instance.destroy()` reports database failures on the service context instead of throwing, the hook reads `_destroyError` from the service snapshot afterwards; errors that are thrown are stored and rethrown.

## Hooks by entity

| Entity        | Create hook              | Destroy hook             |
| ------------- | ------------------------ | ------------------------- |
| Schema        | `useCreateSchema`        | `useDestroySchema`        |
| Model         | `useCreateModel`         | `useDestroyModel`         |
| ModelProperty | `useCreateModelProperty` | `useDestroyModelProperty` |
| Item          | `useCreateItem`          | `useDeleteItem`           |
| ItemProperty  | `useCreateItemProperty`  | `useDestroyItemProperty`  |

## Destroy and delete

All five entity classes (Schema, Model, ModelProperty, Item, ItemProperty) have a `destroy()` method. Destroy always: cleans up subscriptions, removes the instance from caches, and stops the service. In addition:

- **Schema.destroy()** – deletes the schema (and cascade: model_schemas, models, properties) from the database.
- **Model.destroy()** – deletes the model and its properties from the database and updates the Schema context.
- **ModelProperty.destroy()** – deletes the property row from the database and updates the Schema context.
- **Item.destroy()** – performs a **soft delete** (sets `_markedForDeletion` on the seed row); the hook is named `useDeleteItem` because the main user-facing action is removing the item from the app.
- **ItemProperty.destroy()** – deletes the property’s metadata row(s) from the database and removes the property from the parent Item’s context.

## Usage example

```tsx
const { createItem, isLoading, error, resetError } = useCreateItem()

const handleCreate = async () => {
  const item = await createItem('Post', { title: 'Hello' })
  if (item) {
    // use item
  }
  // If creation failed, error is set and can be shown in UI
}

// In UI: show loading spinner when isLoading, show error.message when error, call resetError() when user dismisses error
```

```tsx
const { destroy, isLoading, error, resetError } = useDestroySchema()

const handleUnload = async () => {
  await destroy(schemaInstance)
}
```

## Exports

All of these hooks are exported from the package entrypoint (e.g. `@seedprotocol/sdk`):

- `useCreateSchema`, `useDestroySchema`
- `useCreateModel`, `useDestroyModel`
- `useCreateModelProperty`, `useDestroyModelProperty`
- `useCreateItem`, `useDeleteItem`
- `useCreateItemProperty`, `useDestroyItemProperty`
