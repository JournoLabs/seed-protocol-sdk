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

All `@seedprotocol/*` packages are released together, at one version, and depend on each other at that exact version. Install and upgrade them together (`npm install @seedprotocol/sdk@<version> @seedprotocol/react@<version>`); with a mismatched pair, npm refuses to install `@seedprotocol/react` or `@seedprotocol/publish` (`ERESOLVE`, since they take the SDK as an exact peer), and packages that depend on the SDK, such as `@seedprotocol/query`, install a second copy of it, which splits its module state.

## Prerequisites

- Initialize the SDK client before using Schema, Model, or Item APIs. Pass your config (`filesDir`, optional `endpoints`, optional `dbConfig`, optional `schemaFile`) to `client.init()`. See [CONFIG_EXAMPLE.md](../CONFIG_EXAMPLE.md) for configuration details. On Node, `filesDir` alone is enough: `endpoints.filePaths` and `endpoints.files` default to it. Browser init still requires `endpoints`.

```typescript
import { client } from '@seedprotocol/sdk'

await client.init({
  config: {
    filesDir: '.seed',
    endpoints: { filePaths: '/files', files: '.seed' }, // optional on Node when filesDir is set
  },
  addresses: { owned: ['0x...'], watched: [] }, // optional; legacy `['0x...']` is owned only
})
```

Leaving `addresses` out keeps the addresses stored from an earlier session (the SDK warns once); `addresses: []` clears them. `client.init` runs once: calling it again with the same `config` resolves at once and leaves the stored addresses as they are (change them with `client.setAddresses`; `SeedProvider` and `SeedClientGate` call it when their `addresses` change), while a different `config` throws (`await client.stop()` first; it closes the database and drops cached entities). `client.onReady(cb)` also fires when the client is already ready.

### Address session

Three different address lists, do not mix them:

- **`owned`** — wallets the user controls (EOA + smart/managed account). Persisted lowercased in `app_state`. `addressFilter: 'owned'` and `isItemOwned` always agree: an item is owned when its publisher is in this set, or when it's a local unsealed draft (no publisher, no real uid, no `attestationRaw`). Such a draft was made with no wallet connected and belongs to the next wallet that connects. An empty owned list matches only those drafts; it does not skip the filter.
- **`publisherAddress`** — who new seeds are stamped with (usually the managed account); a seed's versions and property rows take the seed's publisher. Set via the publish wallet session, not by putting the module contract in `owned`.
- **`getAdditionalSyncAddresses`** — extra EAS indexers (legacy executor module). Used for sync and revoke only, never for ownership.

After connect, stamp leftover local drafts:

```typescript
await client.setAddresses({ owned: [eoa, managedAccount] })
await client.claimUnpublishedDrafts(publisherAddress) // automatic if you use setPublishWallet
```

`claimUnpublishedDrafts` only updates unsealed rows (no real uid, no `attestationRaw`). Sealed rows are left alone.

---

## 1. Create a schema with models

A **schema** is a named container for **models**. Each model defines a set of **properties** (name and data type).

### Create behavior (wait for ready)

Schema, Model, ModelProperty, Item, and ItemProperty each run a small state machine. Their **`create()`** methods share the same behavior:

- **Default:** `create()` returns a **Promise** that resolves when the entity is **ready** (state machine in the idle state). You should **`await`** the result before using the entity.
- **Opt-out:** Pass **`{ waitForReady: false }`** as the last argument to get the entity **immediately** (synchronous return). Use this when you manage readiness yourself (e.g. internal loops that call `waitForEntityIdle` later) or when you only need a reference.
- **Timeout:** When waiting, you can pass **`readyTimeout`** (milliseconds; default `15000`) in the same options object, e.g. `{ readyTimeout: 30000 }`.

So in normal app code you’ll write:

- `await Schema.create('Blog')`
- `await Model.create('Post', schema, { properties })`
- `await Item.create({ modelName: 'Post', schemaName: 'Blog', ... })`

and use the returned instance after the promise resolves. Use `{ waitForReady: false }` only when you explicitly want the instance without waiting.

1. Create the schema by name: `await Schema.create('Blog')`.
2. Add models with `await Model.create(modelName, schema, { properties })`. Property definitions use `dataType` (e.g. `'Text'`, `'Number'`, `'Boolean'`, `'Date'`, `'Json'`, `'Html'`, `'Image'`, `'File'`, `'List'`, `'Relation'`).

**Multi-value restriction:** Only `dataType: 'List'` can have multiple values. Relation, Text, Number, and all other types are single-valued. For a list of strings, use `dataType: 'List'` with `refValueType: 'Text'`. For a list of relations, use `dataType: 'List'` with `refValueType: 'Relation'` and `ref` (model name).

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

### Matching names from other publishers (`nameMatch`)

Models and properties are shared on EAS: any app's `Post` publishes under `bytes32 post`, and a
property `title` under `string title`. When the SDK syncs, it matches the names it finds there to
your models and properties, and by default it matches loosely, so `htmlpage`, `HTMLPage` and
`html_pages` all reach your `HTMLPage` model. A schema file can make that stricter with
`nameMatch`, on a property, a model or the whole schema (the most specific one set wins):

```json
{
  "name": "Blog",
  "nameMatch": "normalized",
  "models": {
    "Post": {
      "nameMatch": "exact",
      "properties": {
        "title": { "type": "Text" },
        "tags": { "type": "List", "refValueType": "Text", "nameMatch": "fuzzy" }
      }
    }
  }
}
```

| `nameMatch` | Accepts for `HTMLPage` |
|---|---|
| `exact` | only `html_page`, the name this SDK publishes |
| `normalized` | also case and separator differences: `htmlpage`, `HtmlPage`, `html-page` |
| `fuzzy` (default) | also a plural `s` (`html_pages`); for relations, a trailing `id`/`ids` (`author_id`) |

Use `exact` when nothing from another publisher should be pulled in unless it uses your exact
names. Note that seeds published by older SDK versions (`htmlpage`) are then not found either.
`nameMatch` is read from the schema file (`config.schema` or an imported
schema file); models created with `Model.create` in code use their schema's level. Tightening it
affects later syncs only: data already synced stays. See
[ADR 0009](adr/0009-name-match-strictness.md).

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
      filesDir: '.seed',
      endpoints: { filePaths: '/files', files: '.seed' }, // optional on Node when filesDir is set
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

## Browser: OPFS and hosting

### Supported browsers

| Browser | Minimum | Set by |
| --- | --- | --- |
| Chrome, Edge | 102 | OPFS sync access handles, which SQLite uses for the database |
| Firefox | 114 | Module workers, which SQLocal starts the database in |
| Safari (macOS and iOS) | 26 | `FileSystemFileHandle.createWritable`, which every file write uses |

Versions are from MDN's browser compatibility data. On older browsers `client.init` fails with `UnsupportedBrowserError` (`code === 'BROWSER_UNSUPPORTED'`, `missing` lists what's absent) before it loads or stores anything. To check before init and show your own message, call `checkBrowserSupport()`:

```ts
import { checkBrowserSupport } from '@seedprotocol/sdk'

const { supported, missing } = checkBrowserSupport()
// missing: 'opfs' | 'opfs-writable' | 'web-locks' | 'cross-origin-isolation'
```

`cross-origin-isolation` is a hosting problem, not a browser version (see below). The check can't see what only exists inside workers, so Chrome 86–101 and Firefox 111–113 pass it and fail later in init.

### Hosting

The browser build stores files under the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (via ZenFS). Three integration notes:

1. **Cross-origin isolation** — SQLite WASM / `SharedArrayBuffer` need the document to be cross-origin isolated. `seedVitePlugin()` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (plus `Cross-Origin-Resource-Policy: same-origin`) on the Vite **dev and preview** servers, including `writeHead` so React Router Framework Mode HTML still gets them. Production hosts must set the same headers themselves (nginx, Netlify `_headers`, etc.). Use `COEP: require-corp` if your WASM stack requires it. Opt out in Vite with `isolationHeaders: false`.

2. **Concurrent access** — Avoid reading the same OPFS path while another context still has it open for writing, or before a writer has finished closing/flushing. The SDK retries a narrow class of transient read errors (`NotReadableError` / Chromium’s “permission problems … reference” wording) and `waitForFileWithContent` keeps polling until timeout, but coordinating writers and readers in your app still reduces flakes.

3. **One `@zenfs/*` copy** — Browser file access goes through `@zenfs/core` and `@zenfs/dom`, which the SDK installs at exact versions (`2.7.7` / `1.2.14`). If your app installs them itself, use the same versions; the Vite plugin then dedupes them. A different pair beside the SDK's is a second copy, and `configureSingle` runs against a different module instance than the one the SDK imported.

### Deleting local data

`client.resetLocalData()` deletes the database and every file under `filesDir` from OPFS, for a "start fresh" action when local data stops the app from opening. It works from any client state, including after a failed `client.init`, and needs no reload:

```ts
import { client } from '@seedprotocol/sdk'

const { deleted, failed } = await client.resetLocalData()
if (failed.length) {
  // Each entry is { path, error }, e.g. `${filesDir}/db/seed.db` still open in a tab that didn't close.
}
await client.init(options) // starts on an empty database
```

It stops this tab's client, which closes the database, and posts `close-db` to the other tabs of the same database, each of which stops its client ([MULTI_TAB.md](./MULTI_TAB.md#resetting-local-data)). It waits up to `otherTabsTimeoutMs` (default 10 000) for them to close the database, then deletes `filesDir` one entry at a time. An entry it can't remove goes in `failed` with the browser's error (`NoModificationAllowedError: …`) and the rest are still removed; a directory with a failed entry stays. `deleted` lists what went, children before their directory. Last, it unmounts the file system, whose index still lists the deleted files; the next `init` mounts it again.

The directory is the `filesDir` of the last `client.init` in the page, else `.seed`; pass `{ filesDir }` to name another. A `client.init` called while the reset runs waits for it, in this tab and the others.

A client the reset stops, in this tab or another, ends with `status: 'stopped'` and `context.stopReason: 'reset'` on its snapshot; `client.stop()` and `client.unload()` set `'stop'`. In React, `useGlobalServiceStatus()` returns `stopReason`. The SDK never reloads or navigates: the app decides whether another tab reloads, shows a message or calls `init` again. Outside React, read it from `client.subscribeService`, which runs when the client stops. The tab that called `resetLocalData` sees `'reset'` too, before the delete has finished, so act on it only in the others:

```ts
let resettingHere = false

client.subscribeService((service) => {
  const snapshot = service.getSnapshot()
  if (snapshot.status === 'stopped' && snapshot.context.stopReason === 'reset' && !resettingHere) {
    showDataDeletedNotice() // or location.reload()
  }
})

async function startFresh() {
  resettingHere = true
  try {
    return await client.resetLocalData()
  } finally {
    resettingHere = false
  }
}
```

The SDK keeps nothing in localStorage, so the reset leaves it alone. `@seedprotocol/publish/thirdweb` stores the in-app wallet session there; call its `clearInAppPublishSession()` too if the reset should sign the user out. `resetLocalData` throws in Node.

## Next.js

Use the SDK only in the browser: in client components, initialized through `SeedClientGate`. Wrap your config with `withSeed` from [`@seedprotocol/next`](../packages/next/README.md), which aliases `fs` to ZenFS in browser builds, keeps the SDK's Node code out of server builds, and sends the cross-origin isolation headers under `next dev` and `next start`:

```js
// next.config.mjs
import { withSeed } from '@seedprotocol/next'

export default withSeed({})
```

`app/layout.tsx` can render `SeedProvider` from `@seedprotocol/react` directly. Next.js 16 works with Turbopack and webpack. Next.js 15 works with webpack only, so drop `--turbopack` from `next dev`.

---

## React hooks (browser)

In a React app you can use hooks for schemas, models, items, and item properties. These are exported from **`@seedprotocol/react`** (not from `@seedprotocol/sdk`):

```bash
npm install @seedprotocol/react react @tanstack/react-query
```


- `useSchema`, `useSchemas`, `useCreateSchema`, `useDestroySchema`
- `useModel`, `useModels`, `useCreateModel`, `useDestroyModel`
- `useItem`, `useItems`, `useCreateItem`, `useDeleteItem`
- `useItemProperty`, `useItemProperties`, `useCreateItemProperty`, `useDestroyItemProperty`
- `useModelProperty`, `useModelProperties`, `useCreateModelProperty`, `useDestroyModelProperty`

List hooks (`useSchemas`, `useItems`, `useModels`, `useItemProperties`, `useModelProperties`) use [TanStack React Query](https://tanstack.com/query/latest) for caching when used inside a React Query provider. Wrap your app (or the subtree that uses these hooks) with a provider so results are cached and shared across components.

- **`useItems`** uses `staleTime: 0` on its query (unlike Seed’s default list `staleTime`) so the item list stays aligned with local SQLite and remounts can refetch when needed; it also reconciles against a live query. Schema-backed fields on each item (e.g. list relations such as `authors`) may be `undefined` until loaded—normalize in forms (e.g. default to `[]`).
- **`includeEas` (default `false`)** — By default, `useItems` and `Item.all` only return seeds whose `seeds.uid` is null or empty (local drafts / not yet linked to an on-chain seed attestation in SQLite). To list **both** local-only and already-attested items in one feed, pass **`includeEas: true`**. For “draft vs onchain” badges and EAS explorer links, prefer **`getSeedPublishState({ seedLocalId })`** from `@seedprotocol/sdk` (and `getPublishPendingDiff` for pre-publish change summaries) instead of inferring from `latestVersionUid` alone.
- **EAS File/Image hydration** — In browser apps, after EAS sync the SDK now schedules OPFS asset download automatically and also lazily retries by transaction id when a File/Image property is resolved but the local blob is missing. Expect a short eventual-consistency window where metadata appears before binaries finish hydrating.

### Displaying Html properties

Models can use `dataType: 'Html'` (see the Article example earlier in this guide). Resolved values are **HTML strings**. The SDK does not sanitize them; use **`SeedHtml`** from `@seedprotocol/react` with a sanitizer you provide (for example [DOMPurify](https://github.com/cure53/DOMPurify)).

Install a sanitizer in your app (optional peer; not bundled with Seed):

```bash
bun add dompurify
bun add -d @types/dompurify   # TypeScript projects only
```

Read an `Html` property with `useItemProperty` and render it safely:

```tsx
import DOMPurify from 'dompurify'
import { SeedHtml, useItemProperty } from '@seedprotocol/react'

function ArticleBody({ seedLocalId }: { seedLocalId: string }) {
  const { property } = useItemProperty({ seedLocalId, propertyName: 'body' })
  const raw = property?.value != null ? String(property.value) : undefined
  return (
    <SeedHtml
      html={raw}
      className="prose"
      sanitize={(html) =>
        DOMPurify.sanitize(html, {
          /* tune tags/attributes for your threat model */
        })
      }
    />
  )
}
```

You can also use the **`render`** prop on `SeedHtml` to wrap sanitized HTML in your own element (for example `<article dangerouslySetInnerHTML={{ __html: html }} />` after `SeedHtml` has applied `sanitize`).

To show markup as **plain text** (tags visible, not interpreted), use `{String(property?.value ?? '')}` in a normal element instead of `SeedHtml`.

For HTML from RSS/XML or other feeds, see [FEED_RICH_FIELDS.md](FEED_RICH_FIELDS.md).

If you **publish** a site feed (`@seedprotocol/feed`), the article **`body`** property (or `html` / `content`) is what maps to full HTML in RSS `content:encoded` and JSON Feed `content_html`; keep **`summary`** for short excerpts when you want `description` / `summary` distinct from the full body. Details: [FEED_RICH_FIELDS.md – Publishing feeds](FEED_RICH_FIELDS.md#publishing-feeds-seed--rss--atom--json).

### Images: local item vs feed-style strings

- **Local synced `Image` property** — use **`SeedImage`** with an **`ItemProperty`** instance (local DB, OPFS paths, sized variants). Typical in editors and first-party apps where the item already lives in the Seed client.
- **Opaque strings** (https URL, Arweave tx id, seed UID, etc. from RSS/XML or imports) — use **`SeedMediaImage`** or **`useResolvedMediaRef`** from `@seedprotocol/react`. These do not require an `ItemProperty`.

See [FEED_RICH_FIELDS.md – SeedImage vs SeedMediaImage](FEED_RICH_FIELDS.md#seedimage-vs-seedmediaimage).

### Files: feed-style links vs local `File` properties

- **Opaque file / enclosure strings** (same ref shapes as images) — use **`SeedMediaFile`** from `@seedprotocol/react` with a `value` string; it resolves like **`SeedMediaImage`** and renders a link by default. For loading and error UI, use **`useResolvedMediaRef`** directly.
- **Local `File` properties** — storage is ref/path-based; there is no `SeedFile` twin of `SeedImage` in the SDK yet. Build download or open behavior with **`useItemProperty`**, **`useFiles`**, or your own file helpers.

For RSS/file fields, see [FEED_RICH_FIELDS.md](FEED_RICH_FIELDS.md).

### Json properties

`Json` model properties resolve to parsed objects (or values) in the client. For **read-only display**, use **`SeedJson`** or **`formatSeedJson`** from `@seedprotocol/react` — they only stringify; they do **not** execute code. Never **`eval`** user or feed JSON.

```tsx
import { SeedJson, useItemProperty } from '@seedprotocol/react'

function MetadataView({ seedLocalId }: { seedLocalId: string }) {
  const { property } = useItemProperty({ seedLocalId, propertyName: 'metadata' })
  return <SeedJson value={property?.value} className="text-sm overflow-auto" />
}
```

Use the **`format`** prop to replace formatting entirely, or **`formatOptions`** (`maxDepth`, `maxStringLength`, `space`) to tune the built-in formatter.

### SeedProvider and QueryClient options

The SDK supports three ways to supply a React Query client:

1. **Use SeedProvider as-is (default)**  
   Wrap your app with `<SeedProvider>` after `client.init()`. The SDK creates and uses an internal QueryClient with Seed defaults.

   ```tsx
   import { client } from '@seedprotocol/sdk'
   import { SeedProvider } from '@seedprotocol/react'

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
   import { SeedProvider, getSeedQueryDefaultOptions } from '@seedprotocol/react'
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
   import { createSeedQueryClient } from '@seedprotocol/react'
   import { QueryClientProvider } from '@tanstack/react-query'

   const queryClient = createSeedQueryClient()
   <QueryClientProvider client={queryClient}>
     <App />
   </QueryClientProvider>
   ```

   To merge Seed defaults into your own defaults:

   ```tsx
   import { mergeSeedQueryDefaults } from '@seedprotocol/react'
   import { QueryClient } from '@tanstack/react-query'

   const queryClient = new QueryClient({
     defaultOptions: mergeSeedQueryDefaults({
       queries: { gcTime: 1000 * 60 * 60 },
     }),
   })
   ```

`useItem` and `useItemProperty` also use React Query, but they work without any provider (they fall back to a shared client with Seed defaults). Their cache is the SDK's instance cache: an item or property that is already loaded and ready (for example a row `useItems` just returned) comes back on the first render with `isLoading: false`, and is refreshed in the background.

Example: create a model in a component, then create an item, display it, and update its title.

```tsx
import { useEffect, useState } from 'react'
import { SeedProvider, useSchema, useCreateModel, useModel, useCreateItem, useItem } from '@seedprotocol/react'

function BlogEditor() {
  const { schema } = useSchema('Blog')
  const { create: createModel } = useCreateModel()
  const { model: Post } = useModel('Blog', 'Post') // (schemaName, modelName)
  const { createItem } = useCreateItem()
  const [seedLocalId, setSeedLocalId] = useState<string>()
  const { item } = useItem({ modelName: 'Post', seedLocalId })

  useEffect(() => {
    if (!schema || Post) return
    createModel('Blog', 'Post', {
      properties: { title: { dataType: 'Text' }, content: { dataType: 'Text' } },
    })
  }, [schema, Post])

  const handleCreate = async () => {
    const newItem = await createItem('Post', { title: 'New post', content: '' })
    setSeedLocalId(newItem?.seedLocalId)
  }

  return (
    <div>
      <button onClick={handleCreate} disabled={!Post}>New post</button>
      {item && (
        <input
          value={item.title ?? ''}
          onChange={(e) => { item.title = e.target.value }}
        />
      )}
    </div>
  )
}

// After client.init(), wrap your app with SeedProvider so list hooks (useSchemas, useItems, etc.) share a cache.
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
- [ADR 0016](adr/0016-schema-changes-write-version-files.md) – how schema versions, renames and deletes are stored
- [PUBLISHING.md](PUBLISHING.md) – publish flow and schema setup requirements
