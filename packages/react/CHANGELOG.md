# Changelog

All notable changes to this package are documented in this file.

## 0.7.11 (2026-10-24)

### Commits

#### Breaking

- sdk: drop the unused property_uids table (88635bf0)

#### Fixes

- sdk: fail init the same way in tests as in production (f9343543)

## 0.7.10 (2026-10-24)

- **Breaking:** `useItem` holds the Item it shows once per mounted hook and releases it when the hook unmounts or shows another item, so an item no hook or caller holds is unloaded. Before, each lookup that missed the instance cache took a hold that was never released, and no item `useItem` loaded was ever unloaded. Code that keeps an Item from `useItem` after the component unmounts must hold it itself (`Item.find({ hold: true })` or `Item.retain`, then `unload()` when done).
- **Breaking:** `useItems` holds each item it lists once per mounted hook and releases it when the item leaves the list or the hook unmounts, so an item shown only by a list is unloaded when the list unmounts. Before, every fetch took one more hold on each listed item and none was released, so no listed item was ever unloaded. Code that keeps an Item from `useItems` after the list unmounts must hold it itself (`Item.find({ hold: true })` or `Item.retain`, then `unload()` when done). With the SDK's grace period (`entityCache.unloadGraceMs`, default 60 s), an item unloads that long after the last hook showing it unmounts. The list's query is dropped as soon as no hook uses it (`gcTime: 0`), and a list that includes a stopped instance, or whose item stops while listed, is fetched again (`useItem` looks its item up again the same way).
- **Breaking:** `useSchemas`, `useModels`, `useModel` (by id), `useModelProperties` and `useModelProperty` hold what they show once per mounted hook and release it when the hook unmounts or shows something else; `useSchema` and `useAllSchemaVersions` take their hold explicitly (`hold: true`), since SDK lookups no longer take one. A list that includes a stopped instance, or one whose instance stops while shown (destroyed, evicted), is fetched again, and `useModels` no longer keeps a previous list that holds a stopped model. Definitions stay cached without holds, so these holds only count the hook. `useModelProperty` took a hold on every lookup that was never released.
- **Breaking:** `useCreateModel` and `useCreateModelProperty` create without a cache hold. They held every model and property they created, or looked up, and never released it.
- **Breaking:** `useCreateItem` and `useCreateItemProperty` create without a cache hold (pass `hold: true` in `useCreateItem`'s options to take one, and `unload()` it when done). They held every instance they created and never released it. A created item that no hook shows unloads after the SDK's grace period (`entityCache.unloadGraceMs`, default 60 s).
- `useItem` looks the item up again when the instance it shows is stopped (dropped by another tab, a local purge or `destroy`). It kept showing the stopped instance until the next sync.

### Commits

#### Features

- sdk: unload grace period and no-hold lookups by default (504f56dc)
- sdk: state supported browsers, add checkBrowserSupport() (76447831)

#### Fixes

- definition hooks hold what they show; no leaked create holds (0dbe7b6c)
- useItems holds its items once per mounted hook (2a0a9492)
- sdk: load without Iterator helpers (ZenFS 2.7.7) (f88840eb)
- useItem holds its item once per mounted hook (8e9202d8)

## 0.7.9 (2026-10-22)

- `isClientReadySnapshot` is the SDK's (re-exported unchanged). `useSchema`, `useItem`, `useItemProperty`, `useCreateItemProperty` and the create hooks (`useCreateSchema`, `useCreateModel`, `useCreateModelProperty`) follow the entity's load `status` (`loading` / `ready` / `error`) instead of its machine reaching `idle`, which the SDK's entity machines now are from the start.

- A property save refetches `useItemProperties`' query once, when the change feed reports the row write (in Node, its liveQuery). `SeedProvider` refetched it on the `itemProperty.saved` event and again through `window.__SEED_INVALIDATE_ITEM_PROPERTIES__`, which it no longer sets. `invalidateItemPropertiesForItem` invalidates once and resolves when the refetch is done.
- Init progress no longer has an 80% step: the SDK removed its `addModelsToStore` init state, which did nothing.
- `SeedImage` stops showing an image once its property is cleared or points at another file. It kept the URLs it had found for the previous file.

### Commits

#### Fixes

- useItems returns a new, re-sorted array when a listed item is published (04935e71)

#### Other

- sdk: Item and ItemProperty on the shared entity lifecycle (9f7cf4e5)
- sdk: Schema on the shared entity lifecycle (1aca3008)
- sdk: Model and ModelProperty on the shared entity lifecycle (ba8ae7ba)
- sdk: shared entity cache, lifecycle and client readiness (428c2c2d)
- one item-properties refetch per property save (a082952a)
- sdk: client init steps are awaited functions (T2) (36c928a7)
- sdk: definition writes are one awaited saveDefinition (T2) (9fa7eaef)
- SeedImage stops showing an image once its property is cleared (52b15440)

## 0.7.8 (2026-10-20)

- `useItemProperties` re-reads its item's metadata rows only when a write touched them, through the SDK's change feed (ADR 0020). Before, each mounted hook held a metadata liveQuery that re-ran on every metadata write in the database, in every tab, so a page mounting the hook per row ran one query per row for each save. Writes from other tabs and from sync still reach it. In Node it keeps the polling liveQuery.
- `useItems` lists an item created while its first load is still running. The live query saw the new item and asked for a refetch, but TanStack Query joins a fetch already running when the query has no data yet, so the list came back without the item and stayed that way until another seed changed. The hook now refetches once that fetch settles. A superseded load (new query key, unmount) stops building items through `Item.all`'s new `signal`.
- `useItemProperty` and `useItemProperties` hold the properties they return while mounted and release them on unmount, so a property stops once no component, item or `find` holds it. Before, each lookup took a hold that was never released. `useItemProperties` no longer keeps its list for five minutes after unmount (`gcTime: 0`, as `useItemProperty` already had).
- The status hooks (`useIsClientReady`, `useDbsAreReady`, `useIsDbReady`, `useGlobalServiceStatus`, `useServices`) and `SeedClientGate` follow the client after `client.stop()` and a new `client.init()`. Before, they kept reading the stopped client: they reported ready while the new init ran and didn't re-render when it finished. They now report not ready from `stop()` until the next init finishes, and the gate shows its loading state again without a remount.
- New `useClientService()` returns the current clientManager actor, and `useClientSelector(selector)` derives a value from its snapshot; both follow `stop()` and init.
- `useLiveQuery` and `useLiveQueryState` resubscribe after an error, waiting 0.5 s, then 1, 2, 5, 10 and 30 s between attempts, and keep the last rows meanwhile. An error creating the live query lands in `error` instead of only the console.
- `SeedClientGate` compares `initConfig` and `schema` by value, so an inline object no longer calls `client.init` on every parent render.
- `useService(...).percentComplete` is 100 once the service is idle (it was 0) and, for the client manager, 0–100 during startup (it was `-Infinity`).
- `useCreateSchema`, `useCreateModel` and `useCreateModelProperty` clear `isLoading` when the SDK hands back an instance that is already loaded, and when the create throws (for example an empty name). They read the instance's current state right after subscribing; before, `isLoading` stayed `true` until a state change that never came. A throw also sets `error` and is rethrown.
- Breaking: `useCreateModelProperty`'s `create` returns `Promise<ModelProperty>`. It looks `schemaId` up as a stored schema name or schema file id first, so a schema named `app-2` is no longer cut to `app`; only an id that matches nothing falls back to stripping a `-<version>` suffix. A missing name or `dataType` rejects instead of throwing.
- `useSchema` releases its hold on the cached Schema on unmount and when `schemaIdentifier` changes. Each mount used to add a hold that was never released, so the instance was never unloaded.
- `useModelProperty`'s overloads accept `string | null | undefined`, so passing `null` while an id isn't known yet type-checks. The lookup form now follows the number of arguments: `useModelProperty(schemaId, null, null)` waits, where it used to look `schemaId` up as a property file id.
- Hooks outside `SeedProvider` share one fallback QueryClient with Seed's defaults (`createSeedQueryClient()`). `useModels` (and so `useModel`) built a bare `new QueryClient()` instead, and `useSchemas`, `useModelProperties`, `useFiles` and `useImageFiles` threw without a provider. Development builds log one `console.warn` when the fallback is used; from 0.8 these hooks will throw without `SeedProvider`.
- `react-dom` `^18 || ^19` is a peer dependency. The package already imported `flushSync` from it.
- An input bound to `property.value` from `useItemProperty` keeps every keystroke. The hook re-renders at once when the value changes; before, re-renders were throttled to one per 50 ms while the property saved, and a controlled input that missed one was reset to the old text.
- `useDebouncedItemProperty` saves through `property.setValue(value, { before })`. When the save is refused (the item isn't owned) or the value breaks a rule, the shown value goes back to what it was before the first keystroke of that edit, and `error` reports the failure: an `OwnershipError`, an `ItemPropertySaveValidationError`, or the save's own error. Before, it skipped the setter, so a property without a loaded record schema failed with `Missing propertyRecordSchema`, nothing rolled back, and `error` only reported a failed lookup.
- `useCreateItem`'s `createItem` takes `ItemCreateOptions` (`validate`, `readyTimeout`, `waitForReady`) as a third argument and passes them to `Item.create`. A call made while another is in flight returns that call's promise and item; it returned `undefined`.
- `useEasSyncProcesses`, `useEasSyncProcessesState` and `useEasSyncProcessById` can mount before the client is ready; they threw `Db not configured`. They return `undefined` until then, and `useEasSyncProcessById` with an id reports `isLoading: true`.
- `useResolvedMediaRef` reports `status: 'loading'` and no `href` after `value` changes until the new value resolves. It returned the previous value's `href` for a render or two, sometimes a `blob:` URL it had already revoked.
- `SeedImage` forwards `ref` to its `<img>` on React 18.

### Commits

#### Features

- useItemProperties re-reads through the change feed (96029c26)
- sdk: property.showValue; useDebouncedItemProperty no longer sends machine events (82fd557b)

#### Fixes

- useItems lists an item created during its first load (37bbd22d)
- sdk: count ItemProperty holds by owner (9bf5053f)
- sdk: separate peeking from holding in entity caches (351dad8f)
- settle create hooks, release useSchema hold, one fallback QueryClient (cca0b653)
- declare react-dom as a peer dependency (1096ba39)
- SeedImage forwards ref to its img on React 18 (d3a01b3b)
- useResolvedMediaRef never returns the previous value's href (c8a7237f)
- EAS sync hooks wait for the client before reading the app DB (c1d9abeb)
- useCreateItem takes ItemCreateOptions and shares an in-flight create (c537ba97)
- keep keystrokes in useItemProperty and save debounced edits through setValue (6d9243f1)
- status hooks and SeedClientGate follow the current client (020eee44)

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
