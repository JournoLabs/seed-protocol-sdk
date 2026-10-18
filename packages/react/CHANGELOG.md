# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- `useCreateSchema`, `useCreateModel` and `useCreateModelProperty` clear `isLoading` when the SDK hands back an instance that is already loaded, and when the create throws (for example an empty name). They read the instance's current state right after subscribing; before, `isLoading` stayed `true` until a state change that never came. A throw also sets `error` and is rethrown.
- Breaking: `useCreateModelProperty`'s `create` returns `Promise<ModelProperty>`. It looks `schemaId` up as a stored schema name or schema file id first, so a schema named `app-2` is no longer cut to `app`; only an id that matches nothing falls back to stripping a `-<version>` suffix. A missing name or `dataType` rejects instead of throwing.
- `useSchema` releases its hold on the cached Schema on unmount and when `schemaIdentifier` changes. Each mount used to add a hold that was never released, so the instance was never unloaded.
- `useModelProperty`'s overloads accept `string | null | undefined`, so passing `null` while an id isn't known yet type-checks. The lookup form now follows the number of arguments: `useModelProperty(schemaId, null, null)` waits, where it used to look `schemaId` up as a property file id.
- Hooks outside `SeedProvider` share one fallback QueryClient with Seed's defaults (`createSeedQueryClient()`). `useModels` (and so `useModel`) built a bare `new QueryClient()` instead, and `useSchemas`, `useModelProperties`, `useFiles` and `useImageFiles` threw without a provider. Development builds log one `console.warn` when the fallback is used; from 0.8 these hooks will throw without `SeedProvider`.

## 0.7.7 (2026-10-18)

- The deleted-items query (`useItems` with `deleted: true`) matches rows with `_markedForDeletion = 1` only. It also matched rows where the column was `0`.

### Commits

#### Fixes

- sdk: report Node app DB ready only once it opens; deleted filter matches = 1 (0240c523)

## 0.7.6 (2026-10-17)

- The package is marked `'use client'`, so a React Server Components app (Next.js App Router) can import `SeedProvider` and the components into a server component such as `app/layout.tsx`. Before, that failed with `createContext is not a function`.
- `SeedProvider` takes `config`, `addresses` and `onInitError` and starts the client itself: `<SeedProvider config={config}>` replaces wrapping the app in `SeedClientGate`. Children render straight away and the hooks report loading until the client is ready; `SeedClientGate` is still there for its loading screen. Init runs again only when `config` changes or `addresses` holds different values.
- `SeedClientGate`'s `schema` prop takes the SDK's `SchemaFileInput`, so a schema needs only `metadata.name` and `models`.

### Commits

#### Features

- let SeedProvider start the client (cf7e1d4d)
- mark the package as a client module (9969ecbe)

## 0.7.5 (2026-10-17)

### Commits

#### Fixes

- packages: internal peers use workspace:*, published as the exact version (d2730d9a)
- peer @seedprotocol/sdk ^0.7.0; sync-versions keeps internal peers current (efa789e7)

#### Other

- packages: add READMEs for react, vite, arweave, eas (baf86652)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

## 0.7.4 (2026-10-15)

### Commits

#### Fixes

- sdk, publish: one easName for every name that reaches EAS (eec5ded5)
- export useIsClientReady (4d5f39fd)
- media, JSON and image fixes; export the hooks react.md lists (d6cd5fc5)
- item, item-property and live query hook fixes (6399e9a9)
- sdk: hyphenated schema names aren't cut at the last hyphen (96745809)
- schema hooks: lookup without creating, errors, deletes (ecd251d4)
- model/readiness hooks: stable hook order, real DB readiness, lists that shrink (5c3f4ad8)

## 0.7.3 (2026-10-14)

### Commits

#### Fixes

- usePublishItem reports errors thrown before publishing starts (2d0d906f)
- sdk: client.init fails when the configured schema cannot be loaded (c6cd9cff)
- sdk: addressFilter 'owned' lists what isItemOwned says is owned (f31e5991)
- progressive image URL tries the preferred read gateways (83a9dd02)
- ci: wait longer for npm to show published versions before promoting (c884e492)

## 0.7.1 (2026-10-10)

### Commits

#### Features

- useItem re-renders when one of the item's property values changes (93019eff)
- useItem / useItemProperty return cached ready instances on the first render (6837417d)
- delete folders from OPFSFilesManager (20adaee2)

## 0.7.0 (2026-10-08)

### Commits

#### Breaking

- redesign OPFSFilesManager (4cdf8807)

#### Features

- sdk: keep other tabs current with relayed events and file changes (4492a824)
- SeedClientGate reports init failures through onInitError (a9b6af6d)
- sdk: require a schema when a model name is ambiguous (631df2d5)
- add deleteAction to OPFSFilesManager (841c33fd)
- add onNotify to OPFSFilesManager (97e790d1)

#### Fixes

- sdk: getPropertySchema finds runtime properties on schema-file models (61449bee)
- useModelProperty retries a lookup that found nothing (463b701c)
- useModelProperties follows the model's _dbId (5e3a8be2)
- sdk: readers prefer a live metadata row over a newer revoked one (b2432397)
- keep useItems query key shape unchanged when unscoped (a883de05)
- sdk: scope Item property resolution to the model's schema (9a72d9eb)
- track destroy isLoading/error in hook-local state for all destroy hooks (e46253ad)
- make useDestroySchema report isLoading for fast destroys (9764380c)
- stop OPFSFilesManager's element reset overriding button styles (ac561ebc)
- require @seedprotocol/sdk ^0.6.0 as a peer (6acb12d7)
- build against the workspace SDK, not npm 0.4.25 (e2a978f1)

#### Other

- sdk: drop unused destroy-progress state from entity machines (9c27162c)
- adr: start ADRs; record OPFSFilesManager design decisions (5c00b2d3)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.8 (2026-10-03)

### Commits

#### Other

- Final changes (b9f033a2)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)
- Add ensureImageLocal and progressive SeedImage Arweave fallback. (14f0156f)
- Stop treating a failed client init as ready. (b32df5e7)

## 0.6.3 (2026-09-25)

_Also covers 0.6.1, 0.6.2, published from commits in this range._

### Commits

#### Other

- Fixing item ownership bugs/gaps (2539c65c)

## 0.6.0 (2026-09-22)

### Commits

#### Features

- mapping: add resolve jobs, URL classifier, and AV media roles (ac9ef29c)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- sdk: add client.removeLocalCopiesForAddresses local purge (236098a0)
