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

- `destroy` – function that accepts the entity instance and calls `instance.destroy()` (removes from DB where applicable and unloads)
- `isLoading` – `true` while the destroy operation is in progress (read from the instance’s service)
- `error` – `Error | null`; set when the operation fails (read from the instance’s service)
- `resetError` – call to clear `error` (sends `clearDestroyError` to the instance’s service)

Loading and error state are derived from the entity instance’s service (the instance passed to `destroy()`), not from hook-local state. This keeps the service as the single source of truth for destroy progress and errors.

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
