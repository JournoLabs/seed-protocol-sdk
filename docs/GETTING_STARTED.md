# Getting Started

This guide walks you through the core workflows: creating a schema with models, creating items from those models, and updating item properties.

## Install

```bash
# npm
npm install @seedprotocol/sdk

# yarn
yarn add @seedprotocol/sdk

# bun
bun add @seedprotocol/sdk
```

## Prerequisites

- Initialize the SDK client before using Schema, Model, or Item APIs. Pass your config (endpoints, `filesDir`, optional `dbConfig`) to `client.init()`. See [CONFIG_EXAMPLE.md](../CONFIG_EXAMPLE.md) for configuration details.

```typescript
import { client } from '@seedprotocol/sdk'

await client.init({
  config: {
    endpoints: { /* your EAS endpoint */ },
    filesDir: '.seed',
  },
  addresses: ['0x...'], // optional
})
```

---

## 1. Create a schema with models

A **schema** is a named container for **models**. Each model defines a set of **properties** (name and data type).

### Create behavior (wait for ready)

Schema, Model, ModelProperty, Item, and ItemProperty each run a small state machine. Their **`create()`** methods share the same behavior:

- **Default:** `create()` returns a **Promise** that resolves when the entity is **ready** (state machine in the idle state). You should **`await`** the result before using the entity.
- **Opt-out:** Pass **`{ waitForReady: false }`** as the last argument to get the entity **immediately** (synchronous return). Use this when you manage readiness yourself (e.g. internal loops that call `waitForEntityIdle` later) or when you only need a reference.
- **Timeout:** When waiting, you can pass **`readyTimeout`** (milliseconds; default `5000`) in the same options object, e.g. `{ readyTimeout: 10000 }`.

So in normal app code you’ll write:

- `await Schema.create('Blog')`
- `await Model.create('Post', schema, { properties })`
- `await Item.create({ modelName: 'Post', schemaName: 'Blog', ... })`

and use the returned instance after the promise resolves. Use `{ waitForReady: false }` only when you explicitly want the instance without waiting.

1. Create the schema by name: `await Schema.create('Blog')`.
2. Add models with `await Model.create(modelName, schema, { properties })`. Property definitions use `dataType` (e.g. `'Text'`, `'Number'`, `'Boolean'`, `'Date'`, `'Json'`, `'Html'`, `'Image'`, `'File'`, `'List'`, `'Relation'`).

**Example: schema with a single model**

```typescript
import { Schema, Model } from '@seedprotocol/sdk'

// Create a schema. Default: waits until ready.
const schema = await Schema.create('Blog')

// Add a model with properties. Default: waits until ready.
const Post = await Model.create('Post', schema, {
  properties: {
    title: { dataType: 'Text' },
    content: { dataType: 'Text' },
    published: { dataType: 'Boolean' },
    wordCount: { dataType: 'Number' },
  },
})

```

**Example: schema with multiple models**

```typescript
import { Schema, Model } from '@seedprotocol/sdk'

const schema = await Schema.create('MyApp')

const Article = await Model.create('Article', schema, {
  properties: {
    headline: { dataType: 'Text' },
    body: { dataType: 'Html' },
    publishedAt: { dataType: 'Date' },
  },
})

const Author = await Model.create('Author', schema, {
  properties: {
    name: { dataType: 'Text' },
    bio: { dataType: 'Text' },
  },
})
```

You can also create a model by schema name (string) instead of a schema instance. The schema will be resolved by name:

```typescript
const Post = await Model.create('Post', 'Blog', {
  properties: {
    title: { dataType: 'Text' },
    content: { dataType: 'Text' },
  },
})
```

---

## 2. Create an item from a model

Once a model exists, create **items** (data records) from it. Each item has a value for each model property. **`Item.create()`** and a model’s **`create()`** (e.g. `Post.create()`) also wait for the item to be ready by default; you can pass **`{ waitForReady: false }`** or **`readyTimeout`** as a second argument to `Item.create()`.

**Using the model’s `create` method (recommended)**

```typescript
import { Schema, Model } from '@seedprotocol/sdk'

const schema = await Schema.create('Blog')
const Post = await Model.create('Post', schema, {
  properties: {
    title: { dataType: 'Text' },
    content: { dataType: 'Text' },
  },
})

const item = await Post.create({
  title: 'My first post',
  content: 'Hello, world!',
})

console.log(item.seedLocalId)  // item's local id
console.log(item.title)        // 'My first post'
console.log(item.content)      // 'Hello, world!'
```

**Using `Item.create` directly**

You can create an item by passing `modelName` (and optional `schemaName`) plus property values:

```typescript
import { Item } from '@seedprotocol/sdk'

const item = await Item.create({
  modelName: 'Post',
  schemaName: 'Blog',  // optional if you have a single schema
  title: 'Another post',
  content: 'Some content here.',
})
```

---

## 3. Update properties on an item

Item properties are updated by **assigning to the property on the item**. The SDK syncs these changes to the database.

```typescript
// Create an item
const item = await Post.create({
  title: 'Draft post',
  content: 'Initial content.',
})

// Update by assignment
item.title = 'Updated title'
item.content = 'Revised content.'

// Read back
console.log(item.title)   // 'Updated title'
console.log(item.content) // 'Revised content.'
```

You can also read and update via the `properties` array (each element has `propertyName` and `value`):

```typescript
// Find a property and update its value
const titleProp = item.properties.find((p) => p.propertyName === 'title')
if (titleProp) {
  titleProp.value = 'New title'
}
console.log(item.title) // 'New title'
```

---

## Full example

```typescript
import { client, Schema, Model } from '@seedprotocol/sdk'

async function main() {
  await client.init({
    config: {
      endpoints: { /* your EAS endpoint */ },
      filesDir: '.seed',
    },
  })

  const schema = await Schema.create('Blog')
  const Post = await Model.create('Post', schema, {
    properties: {
      title: { dataType: 'Text' },
      content: { dataType: 'Text' },
    },
  })

  const item = await Post.create({
    title: 'First post',
    content: 'Hello!',
  })

  item.title = 'First post (updated)'
  item.content = 'Hello, world!'

  console.log(item.seedLocalId, item.title, item.content)
}
```

---

## React hooks (browser)

In a React app you can use hooks for schemas, models, items, and item properties. These are exported from the main package:

- `useSchema`, `useSchemas`, `useCreateSchema`, `useDestroySchema`
- `useModel`, `useModels`, `useCreateModel`, `useDestroyModel`
- `useItem`, `useItems`, `useCreateItem`, `useDeleteItem`
- `useItemProperty`, `useItemProperties`, `useCreateItemProperty`, `useDestroyItemProperty`
- `useModelProperty`, `useModelProperties`, `useCreateModelProperty`, `useDestroyModelProperty`

List hooks (`useSchemas`, `useItems`, `useModels`, `useItemProperties`, `useModelProperties`) use [TanStack React Query](https://tanstack.com/query/latest) for caching when used inside a React Query provider. Wrap your app (or the subtree that uses these hooks) with a provider so results are cached and shared across components.

### SeedProvider and QueryClient options

The SDK supports three ways to supply a React Query client:

1. **Use SeedProvider as-is (default)**  
   Wrap your app with `<SeedProvider>` after `client.init()`. The SDK creates and uses an internal QueryClient with Seed defaults.

   ```tsx
   import { SeedProvider, client } from '@seedprotocol/sdk'

   await client.init({ config: { ... } })

   root.render(
     <SeedProvider>
       <App />
     </SeedProvider>
   )
   ```

2. **Pass your own QueryClient**  
   If you already have a QueryClient (e.g. from another part of your app), pass it so Seed hooks use the same cache. You can merge Seed defaults when creating it (see option 3).

   ```tsx
   import { SeedProvider, getSeedQueryDefaultOptions } from '@seedprotocol/sdk'
   import { QueryClient } from '@tanstack/react-query'

   const queryClient = new QueryClient({
     defaultOptions: getSeedQueryDefaultOptions(),
   })

   <SeedProvider queryClient={queryClient}>
     <App />
   </SeedProvider>
   ```

3. **Use your own QueryClientProvider**  
   If you want a single provider for your app and Seed, create a client with Seed defaults and pass it to TanStack’s `QueryClientProvider`, or merge Seed defaults into your existing client config.

   ```tsx
   import { createSeedQueryClient, mergeSeedQueryDefaults } from '@seedprotocol/sdk'
   import { QueryClientProvider } from '@tanstack/react-query'

   const queryClient = createSeedQueryClient()
   <QueryClientProvider client={queryClient}>
     <App />
   </QueryClientProvider>
   ```

   To merge Seed defaults into your own defaults:

   ```tsx
   import { mergeSeedQueryDefaults } from '@seedprotocol/sdk'
   import { QueryClient } from '@tanstack/react-query'

   const queryClient = new QueryClient({
     defaultOptions: mergeSeedQueryDefaults({
       queries: { gcTime: 1000 * 60 * 60 },
     }),
   })
   ```

Example: create a schema and model in a component, then create and display an item and update its title.

```tsx
import { SeedProvider, useSchema, useCreateModel, useModel, useCreateItem, useItem } from '@seedprotocol/sdk'

function BlogEditor() {
  const schema = useSchema('Blog')
  const createModel = useCreateModel()
  const Post = useModel('Post', 'Blog')
  const createItem = useCreateItem()
  const [itemId, setItemId] = useState<string | null>(null)
  const item = useItem(itemId ?? '')

  useEffect(() => {
    if (!schema) return
    createModel?.('Post', schema, {
      properties: { title: { dataType: 'Text' }, content: { dataType: 'Text' } },
    })
  }, [schema])

  const handleCreate = async () => {
    if (!Post) return
    const newItem = await Post.create({ title: 'New post', content: '' })
    setItemId(newItem.seedLocalId ?? newItem.seedUid ?? null)
  }

  return (
    <div>
      <button onClick={handleCreate}>New post</button>
      {item && (
        <input
          value={item.title ?? ''}
          onChange={(e) => { item.title = e.target.value }}
        />
      )}
    </div>
  )
}

// Wrap your app with SeedProvider so list hooks (useSchemas, useItems, etc.) use shared caching.
root.render(
  <SeedProvider>
    <BlogEditor />
  </SeedProvider>
)
```

---

## Next steps

- [CONFIG_EXAMPLE.md](../CONFIG_EXAMPLE.md) – client configuration and database options
- [DATA_ACCESS_PATTERNS.md](DATA_ACCESS_PATTERNS.md) – patterns for reading and writing data
- [SCHEMA_CREATION_FLOW.md](SCHEMA_CREATION_FLOW.md) – how schema and model creation work under the hood
