# @seedprotocol/react

[![npm](https://img.shields.io/npm/v/@seedprotocol/react.svg)](https://www.npmjs.com/package/@seedprotocol/react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-seedprotocol.io-0B6E4F)](https://seedprotocol.io)

React hooks and components for [Seed Protocol](https://seedprotocol.io). Read and write schemas, models, items and item properties from [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk) in React. Lists stay in sync with the local SQLite database through live queries and [TanStack Query](https://tanstack.com/query/latest). The package also ships components that render images, media, HTML and JSON from Seed items.

## Installation

`@seedprotocol/sdk`, `react` (18 or 19) and `@tanstack/react-query` (v5) are peer dependencies:

```bash
npm install @seedprotocol/react @seedprotocol/sdk @tanstack/react-query react
# or
bun add @seedprotocol/react @seedprotocol/sdk @tanstack/react-query react
# or
pnpm add @seedprotocol/react @seedprotocol/sdk @tanstack/react-query react
```

For Vite browser apps, also add [`@seedprotocol/vite`](https://www.npmjs.com/package/@seedprotocol/vite).

## Usage

Initialize the client and wrap your app. `SeedClientGate` calls `client.init()` and shows a loading UI until the client is ready. `SeedProvider` supplies the QueryClient the list hooks use.

```tsx
import { SeedProvider, SeedClientGate } from '@seedprotocol/react'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'

const initConfig: SeedConstructorOptions = {
  config: {
    filesDir: '.seed',
    endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' },
  },
}

export function Root() {
  return (
    <SeedProvider>
      <SeedClientGate initConfig={initConfig}>
        <App />
      </SeedClientGate>
    </SeedProvider>
  )
}
```

You can also call `client.init()` from `@seedprotocol/sdk` yourself and render `<SeedProvider>` after it resolves.

List, create and read items:

```tsx
import { useItems, useCreateItem, useItemProperty } from '@seedprotocol/react'

function Posts() {
  const { items, isLoading } = useItems({ modelName: 'Post' })
  const { createItem } = useCreateItem()

  if (isLoading) return <p>Loading…</p>
  return (
    <>
      <button onClick={() => createItem('Post', { title: 'New post' })}>New post</button>
      <ul>
        {items.map((item) => (
          <PostTitle key={item.seedLocalId} seedLocalId={item.seedLocalId} />
        ))}
      </ul>
    </>
  )
}

function PostTitle({ seedLocalId }: { seedLocalId: string }) {
  const { property } = useItemProperty({ seedLocalId, propertyName: 'title' })
  return <li>{String(property?.value ?? '')}</li>
}
```

By default `useItems` returns only local items that have no on-chain seed yet. Pass `includeEas: true` to include items that are already attested.

Render an `Html` property with a sanitizer you supply (the SDK does not sanitize HTML):

```tsx
import DOMPurify from 'dompurify'
import { SeedHtml } from '@seedprotocol/react'

<SeedHtml html={body} sanitize={(html) => DOMPurify.sanitize(html)} />
```

## API

| Area | Exports |
|------|---------|
| Setup | `SeedProvider`, `SeedClientGate`, `createSeedQueryClient`, `getSeedQueryDefaultOptions`, `mergeSeedQueryDefaults` |
| Schemas | `useSchema`, `useSchemas`, `useCreateSchema`, `useDestroySchema`, `useAllSchemaVersions` |
| Models | `useModel`, `useModels`, `useCreateModel`, `useDestroyModel` |
| Model properties | `useModelProperty`, `useModelProperties`, `useCreateModelProperty`, `useDestroyModelProperty` |
| Items | `useItem`, `useItems`, `useCreateItem`, `usePublishItem`, `useDeleteItem` |
| Item properties | `useItemProperty`, `useItemProperties`, `useDebouncedItemProperty`, `useCreateItemProperty`, `useDestroyItemProperty`, `invalidateItemPropertiesForItem` |
| Live data | `useLiveQuery` (Drizzle query to live rows), `useDbsAreReady`, `useIsDbReady` |
| Sync and services | `useEasSyncProcesses`, `useEasSyncProcessById`, `useServices`, `useService`, `useGlobalServiceStatus`, `useSeedAddressRevision` |
| Files | `useFiles`, `useImageFiles`, `useOPFSFiles`, `useEnsureLocalImage`, `OPFSFilesManager` |
| Rendering | `SeedImage` (local `Image` property), `SeedMediaImage`, `SeedMediaAudio`, `SeedMediaVideo`, `SeedMediaFile`, `useResolvedMediaRef` (URL, Arweave tx id or seed UID strings), `SeedHtml`, `SeedJson`, `formatSeedJson` |

`useItem` and `useItemProperty` work without a provider: they fall back to a shared QueryClient with Seed defaults. The list hooks (`useSchemas`, `useModels`, `useItems`, `useItemProperties`, `useModelProperties`) should run inside `SeedProvider`, or inside your own `QueryClientProvider` with a client from `createSeedQueryClient()`.

If another tab already has the app's storage open, `client.init()` fails with a `FileSystemLockedError` (`code === 'OPFS_LOCKED'`). Handle it with `SeedClientGate`'s `onInitError` prop.

## Documentation

- Full documentation: **https://seedprotocol.io**
- [Getting started](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/GETTING_STARTED.md) (includes a React hooks section)
- [Data access patterns](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/DATA_ACCESS_PATTERNS.md)
- [Multi-tab behavior](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/MULTI_TAB.md)
- Core SDK: [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk)

## License

MIT
