# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- The bulk file download after each EAS sync skips transactions whose file is already on disk (a non-empty `<txId>` or `<txId>.<ext>` under `images/`, `html/`, `json/` or `files/`, or, for a composite with known child paths, every routed child). Before, every run fetched every known file from the gateway again, rewrote it in OPFS and announced it as changed in every tab. Lazy downloads of one file (`ensureImageLocal`, hydration) still always download.
- The bulk download no longer writes `metadata.content_hash` (nothing read it) and no longer runs a bulk 480 px resize afterward, which never resized anything. Image saves and `ensureImageLocal` still create the size variants.
- The image resize worker recognises a WebP file with no MIME type. It compared the fourth byte with `R` instead of `F` (`RIFF`), so such files went to `createImageBitmap` labelled `image/jpeg`.
- The SDK registers the clients from `@seedprotocol/arweave` and `@seedprotocol/eas` (`DefaultArweaveClient`, `DefaultEasClient`, `DefaultQueryClient`) on both platforms instead of its own copies. Behaviour that changes:
  - On Node, `BaseArweaveClient.getTransactionData` tries the preferred read gateways (`setPreferredArweaveReadBaseUrls`, `config.gateway`) before the configured host, as the browser already did.
  - In the browser, EAS query results are keyed by EAS endpoint, so a page that switches chains never reuses another chain's result; a settled result is kept only for the caller's `staleTime` instead of 5 minutes; and `networkMode: 'onlineOnly'` reaches TanStack Query as `'online'` (it was passed through unmapped and acted like `'always'`).
- Revoking a seed no longer sends version or metadata uids stored as `'NULL'`, blank, or a zero uid in upper case or with spaces. `getVersionsForSeedUid`, `getMetadataAttestationUidsForSeedUid` and publish's draft check now use `isPlaceholderUid` from `@seedprotocol/eas`.
- The download and resize workers use the SDK's MIME sniffer. An untyped file is labelled `image/heic` for every HEIF brand (it was `image/jpeg` for all but `heic`), and a download starting with `BM` goes to `images/` only when it is longer than a BMP header. ICO files are sniffed as `image/x-icon` on upload too.
- `resolveMediaRef` documents that a `localBlob` href is a new blob: URL per call, which the caller revokes; `useResolvedMediaRef` does.
### Breaking

- **A local database written by an SDK older than 0.7.7 is recreated.** On the first start with this version, `prepareDb` drops every table of such a database before migrations run (browser and Node), and logs a `console.warn` saying so. Items that were never published are gone; published items come back with the next EAS sync. A database 0.7.7 or later opened is kept as it is. Files under `filesDir` are not deleted. The SDK tells the two apart by the last applied migration (0020 or later means 0.7.8+ opened it) and, for databases on migration 0019, by the `storedDisplayUrlsCleared` appState key that 0.7.7's first start wrote.
- The repairs for data written by 0.7.1–0.7.6 are removed, since no such database is opened any more: the legacy ItemStorage row migration (and publish's lazy conversion of those rows), the ambiguous-legacy-item reset, the foreign-attestation cleanup, the row-publisher alignment, the stored display URL clearing, and sync's fixes for doubled quotes in `seeds.attestation_raw` and for foreign version and property rows.
- Removed exports: `restoreDataItemIdsOverwrittenByL1` and `applyArweaveL1TransactionIdLocal`.
- Removed public APIs that had no users. PermaPress uses none of them, so it needs no change.
  - The Markdown import (`@seedprotocol/sdk/node`): `parseMarkdownFrontmatter`, `processSeedConfig`, `saveModelsFromMarkdown`. The SDK no longer depends on `js-yaml`. To define models in a file, write a schema file and pass it to `importJsonSchema` or `config.schema`.
  - The CLI and webpack helpers on `@seedprotocol/sdk/node`: `PathResolver`, `BasePathResolver`, `commandExists`, `ensureNodeDbSchema`, `runSeedInit`, `findSeedBinary`, `INIT_SCRIPT_SUCCESS_MESSAGE`, `SCHEMA_TS` and `withSeed`. Use `withSeed` from `@seedprotocol/next` for Next.js. `PlatformServices` (`@seedprotocol/sdk/platform`) no longer has `pathResolver`. On Node, `.seed` is still `<process.cwd()>/.seed`.
  - The schema file API: `createSchema`, `readSchema`, `deleteModelFromSchema` and `deletePropertyFromModel`. Files written by `createSchema` were never loaded; change schemas through `Schema`, `Model` and `ModelProperty`.
  - `requestEasSyncFromEventBus` and the `EasSyncRequestSource` type. Nothing emitted the `syncDbWithEas` event it listened for; call `client.syncFromEas()` instead.
  - Unused types: `SeedInitBrowserProps`, `SeedInitBrowser`, `DbQueryResult`, `ResultObject`, `SqliteWasmResult`, `SqliteWasmCallback`, `ReturnObj`, `PublishRequestData`, `PropertyToUpdateWithSeed`, `GlobalMachineContext`, `PublishMachineContext`, `GetSchemaForModelEvent`, `HydrateExistingItemEvent`, `WebpackConfigContext`, `Environment` and `ClientCallback`.

## 0.7.8 (2026-10-20)

- Browser init no longer fails with `DatabaseNotPersistentError` in Chromium builds that refuse workers started from a worker with an http(s) URL (seen in the Claude desktop app's browser pane). SQLite's OPFS VFS starts its async proxy that way from inside SQLocal's worker, so the VFS didn't install and SQLocal opened a memory database. The blob that starts SQLocal's worker now first installs a `Worker` replacement that starts nested http(s) workers from a blob: `import` for module workers, `importScripts` for classic ones, with later `importScripts` calls resolved against the original URL. This applies wherever SQLocal's worker URL is http(s), in dev and in builds; a bundler that inlines the worker as a `blob:` or `data:` URL skips it. Apps that installed their own nested-worker workaround can remove it.
- `DatabaseNotPersistentError` on a cross-origin isolated page says SQLite's OPFS VFS failed to install and points to SQLite's console lines, instead of telling you to set COOP/COEP headers that are already set. The constructor takes an optional second argument, `'headers'` (default) or `'vfs'`.
- New exports `watchEntityChanges(watch, listener)` and `watchEntityRows(watch, read, onRows, options)` subscribe to the change feed (ADR 0020) for one seed's `seeds`, `versions` or `metadata` rows, and `isChangeFeedRunning()` says whether this tab has a feed (browser only). `@seedprotocol/react` uses them for `useItemProperties`.
- A write no longer re-runs a query for every loaded Item and ItemProperty. Each Item held two liveQueries and each ItemProperty one, and every write to `seeds`, `versions` or `metadata` re-ran all of them in every tab: 400 statements per create and 320 per property save with 40 items of 8 properties loaded, which held up any find or load issued meanwhile (563 ms for an uncached `Item.find` right after a create). Now migration 0023 adds an `entity_changes` table that triggers fill on every write to those tables, each tab runs one query on it, and only the entities whose seed was written re-read their rows (ADR 0020): 2 statements per create and 3 per save, and the same find takes 114 ms. The triggers add 1–3 ms to a write. Other tabs' writes still reach loaded entities. `BaseDb.liveQuery` and the React hooks' own liveQueries are unchanged.
- `DEBUG=seedSdk:timing` logs how long item creates, finds and property saves spend in each phase (for saves: ownership check, schema lookup, the write, waiting for the property to settle; for `createNewItem`: model resolve, schema lookups, seed fields, applying the outbox op). It also logs when `Item.find`, `Item.create` or `Item.all` waited out a ready timeout and continued, naming the item and the properties still loading, and why `Item.find` returned `undefined`.
- `addresses.persisted` (`ADDRESSES_PERSISTED_EVENT`) fires only when the stored owned or watched addresses change, compared without case or order. Before, every `setAddresses()` and every init that saved addresses fired it, so a wallet reconnecting with the same address made React's `useItems` reload its list from scratch.
- `Item.all` takes a `signal` (`AbortSignal`). Once it aborts, `Item.all` stops building items and rejects with the signal's reason.
- Saving a property no longer waits on the EAS indexer each time. A save of a Text, Number, Date, List, Relation or Image value whose row had no EAS schema UID sent one uncached schema request before writing, which took seconds against a slow indexer. Saves now use the same cache as item creation (found UIDs kept, misses for 5 minutes), and `createNewItem` looks up all of a model's property schemas in parallel instead of one after another. Learning a schema UID, for example a model UID read from the local database during an Image save, now forgets only the cached misses that schema answers; before, it forgot all of them, so the next create and saves asked EAS again for every property.
- Requests to the EAS indexer abort after 30 s (`EAS_REQUEST_TIMEOUT_MS` in `@seedprotocol/eas`). Before, a stalled indexer held any create or save waiting on a schema lookup indefinitely.
- **Behavior change: an item's properties stop when the item does.** An Item holds each ItemProperty in its property map once and releases it when the item's last `unload()` (or `destroy()`) stops it, so a property nobody else holds stops with it and its liveQueries close. Each `ItemProperty.find()` or `ItemProperty.create()` is one hold of its own, released by one `property.unload()`. Before, the SDK took up to three uncounted holds per property while loading an item (refCount 4 after `Item.create` plus one `find` in the browser), so properties almost never stopped. Code that called `property.unload()` in a loop until the actor stopped should call `item.unload()` once and `property.unload()` once per `find`. A property read through `item.properties` after its item is unloaded is stopped: keep the item loaded, or `find` the property, to keep using it.
- **Behavior change: the SDK revokes the blob URLs it mints for Image and File values.** A URL from `property.value` works while it is the current value and the property is loaded. It is revoked when the value moves to another file and when the property stops. Before, none were revoked. Blob URLs the app passes in as values are left alone. Also fixed: an Image or File property with no display URL minted a new one about 60 times a second (0.7.5–0.7.6 after every save), and every write to its metadata row showed the storage seed id as the value for a moment.
- A property unloaded while a context update was still being processed could be put back in the instance cache as a stopped, unproxied instance, and a later `find` returned it. Re-keying after create now reuses the instance's own cache entry and skips stopped instances.
- `client.subscribeService(listener)` calls `listener` with the clientManager actor when `client.init()` after `client.stop()` replaces it and when `stop()` ends it. It returns an unsubscribe function. `getService()` is unchanged.
- `BaseDb.liveQuery` in the browser logs SQLite errors through `debug` (`seedSdk:browser:db:Db`) instead of `console.error`. Subscribers still get the error.

### Commits

#### Features

- react: useItemProperties re-reads through the change feed (96029c26)
- Item watches its seed row and versions through the change feed (59aca5c5)
- ItemProperty watches its metadata rows through the change feed (0a823e56)
- one change feed per tab over entity_changes (54d23644)
- log seeds, versions and metadata writes in entity_changes (e8288870)
- the drainer checks a Relation value's local targets (cddab0fa)
- sync keeps a local draft over a newer synced value and records the conflict (e050188e)
- read overlay for item property lists and storage values (6ecfcafc)
- react: property.showValue; useDebouncedItemProperty no longer sends machine events (82fd557b)
- prune settled outbox ops (dce7e2b4)
- record conflicts between a pending edit and a synced value (32a497e4)
- the outbox checks item ownership before applying an op (317438e3)
- Item.create, deletes and the other writers go through the outbox (fa4463b2)
- seedSdk:timing phase logs and an item latency bench (984a4d7e)
- ItemStorage values through the outbox; propertyWriteQueue becomes tickets (c38cc040)
- Html, File and Image values are written through the outbox (d07e3bd6)
- plain item values are written through the outbox (b48f7241)
- outbox core: append, coalesce, claim-and-apply, retry, leader drain (3686a277)
- pending_writes table for the item write outbox (5077bea8)
- BaseDb.transaction; upgrade SQLocal to 0.18 (bfe30123)
- client.subscribeService reports clientManager swaps and stop (6d3a1d2f)

#### Fixes

- drop unused BaseDb import in browser Db (c60552ff)
- set updated_at on every seeds, versions and metadata write (2a6f10f1)
- overlay readers read pending ops before the stored row (b25eff1e)
- the drainer doesn't wait on a held ItemStorage file lock (9dde5d2f)
- claimUnpublishedDrafts claims drafts whose create op is pending (b0bd8e5f)
- replace the Node connection after SQLITE_BUSY so later writes aren't lost (d7842498)
- analyzeInput reports failures through .catch (ee24aa0d)
- react: useItems lists an item created during its first load (37bbd22d)
- a property dropped with its item stays out of the cache (954ca315)
- Item.all honors waitForReady; item context keeps early keys (5959803a)
- a schema's last unload releases its models (1fe5cbf4)
- count ItemProperty holds by owner (9bf5053f)
- Image and File values keep one blob URL, and replaced ones are revoked (0ff7b0ae)
- separate peeking from holding in entity caches (351dad8f)
- key entity state by actor so proxies find their liveQueries (d13c4998)

#### Other

- let column hooks stamp created_at and updated_at (70f4458c)
- Item.find by seedLocalId looks up the local id first (a1d68174)
- an item's property loads share one read of the model's property schemas (175bf953)
- an item's properties share one read of its pending outbox values (d7eb8949)
- timing lines for worker queue, live-query runs and item/property loads (9b0e8dde)
- share identical live queries and drop duplicate initial reads (03105d32)
- index metadata, versions and seeds lookup columns (migration 0021) (6548f692)
- saves and creates read EAS schema UIDs from the lookup cache (ec022380)
- item writers take a db, for use inside a transaction (33809d6a)
- compare entities by actor in cache lookups; save-order and dual-key tests (475936af)
- one reactive proxy factory for every entity (71cb5da8)

## 0.7.7 (2026-10-18)

- **Breaking: client methods throw `CLIENT_NOT_INITIALIZED` after `client.stop()` or `client.unload()`** until `client.init()` runs again. Before, `getAddresses()`, `setAddresses()`, `syncFromEas()` and the other client methods kept working against the open database after a stop. A second `stop()` or `unload()` now does nothing and logs a `console.warn` instead of stopping again, so teardown code that stops twice keeps working and shows where the extra call is.
- **`ItemProperty.save()` and `item.publish()` reject with the error that was thrown**, so `instanceof` and fields like `code` and `cause` work: an `OwnershipError` from an assignment the item's owner check refused, or `@seedprotocol/publish`'s `ManagedAccountPublishError` with its `code`. Before, both rejected with a plain `Error` carrying only the message (and, for `save()`, the name). `save()`'s message is now the original one, without the `Failed to save property <name>:` prefix. The machine context's `_saveError` and `_publishError` hold the `Error` itself instead of `{ message, name }`. `usePublishItem`'s `error` gets the class too.
- A value that breaks its property's rules no longer stays shown after its save is rejected. `property.value`, `Item.find` and `Item.all` kept the rejected value for the rest of the session although nothing was written; now they go back to the value from before the assignment, as they already did for ownership refusals.
- A non-list `Relation` whose schema sets a `refValueType` other than `Image` saves its value. The save resolved without writing anything, so the value was gone after a reload.
- New `property.setValue(value, { before })` shows a value and saves it, as assigning `property.value` does, but saves even when the value is already in context. `before` is what to restore if the save is refused or rejected; pass it when your code put the value into context itself, such as a debounced input.
- `Item.create` throws `ItemCreateError` (exported) when a File, Image, Html or ItemStorage value fails to save for a reason other than its rules, for example an ownership refusal. It has `code` (`'save_failed'` or `'property_not_loaded'`), `modelName`, `property`, the removed draft's `seedLocalId`, and the save's own error as `cause`. Before, it was a plain `Error` with the same message. Rule failures still throw `ItemCreateValidationError`.
- `item.destroy()` soft-deletes only that item's seed row. It matched the row by local id or uid, and `seeds.uid` isn't unique, so destroying one item also marked every other local row with the same uid as deleted.
- `Item.all(modelName, true)` (deleted items) lists rows with `_markedForDeletion = 1` only. It also listed rows where the column was `0`, which the non-deleted list includes too.
- A loaded item claimed by `client.claimUnpublishedDrafts` stops on its owner's `unload()`. The claim took a cache hold on each loaded item it updated and never released it, so the item kept running.
- A schema file in the complete format (`$schema` and `metadata`) with no `metadata.name` fails init with `Could not load config.schema: Schema name is required (either at top level or in metadata.name)`. It failed with a raw SQL error (`Failed query: …`).
- `nameMatch` levels (ADR 0009) load before `client.init` resolves. Until they loaded, a few seconds after init, model lookups by EAS type treated every model as `'fuzzy'`, so a model set to `'exact'` matched plural or misspelled types; each schema write reopened that window. After a schema write, lookups keep the previous levels until the reload finishes.
- On Node, `BaseDb.isAppDbReady()` returns `false` until the database is open, as in the browser. It returned `true` before init.

### Commits

#### Breaking

- client methods throw after stop(); a repeat stop() warns (dbf17511)

#### Features

- typed ItemCreateError for storage values that fail to save (d6a9ca17)
- add ItemProperty.setValue(value, { before }) (f9fd4c5e)

#### Fixes

- save Relation values whose schema sets refValueType (b534e2d6)
- roll back rejected values and keep thrown error classes (bf291c53)
- load nameMatch levels before init reports ready (0434a069)
- reject a complete-format schema file with no metadata.name (83c0a5a5)
- claimUnpublishedDrafts no longer holds claimed loaded items (8cb73bf9)
- Item.destroy soft-deletes only its own seed row (2e2a2ea9)
- report Node app DB ready only once it opens; deleted filter matches = 1 (0240c523)
- mint File display URLs from the file instead of storing them (53063d7d)
- publish: direct-to-EAS refuses an update aimed at an earlier request (6f06bc28)
- publish: record published list/relation values as the attested seed uids (076a6927)

#### Other

- move internal working docs out of the repo, record their decisions as ADRs (f770a365)

## 0.7.6 (2026-10-17)

- **Breaking: browser `client.init` fails with `DatabaseNotPersistentError` (`code === 'DB_NOT_PERSISTENT'`) when SQLite can't store its database in OPFS.** OPFS storage needs `SharedArrayBuffer`, which browsers only expose on pages served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). Before, a page without those headers started normally on an in-memory database and lost every item on reload, with only a console warning from SQLite. `@seedprotocol/vite` sets the headers on the Vite dev and preview servers; production hosting has to send them too. `SeedClientGate`'s `onInitError` receives the error.

- The SDK has no peer dependencies. `@zenfs/core` (2.5.6), `@zenfs/dom` (1.2.9), `xstate` and `drizzle-orm` are regular dependencies, so installing `@seedprotocol/sdk` installs them; apps don't need to add them or match the ZenFS versions. The SDK no longer depends on `@tanstack/react-query` (its browser query cache uses `@tanstack/query-core`); `@seedprotocol/react` still declares React Query as a peer. `fsevents` is gone from the optional dependencies; nothing used it.

- New `@seedprotocol/sdk/drizzle` entry re-exports `drizzle-orm` (`eq`, `and`, `like`, `sql`, ...) from the copy the SDK uses. Import query operators from there to query the SDK's tables without installing `drizzle-orm` or keeping it on the SDK's 0.44 range.

- `client.init({ config: { schema } })` is enough. `filesDir` defaults to `endpoints.files`, then `'.seed'`, and `endpoints` defaults to `filesDir`, in the browser too. Before, browser init failed with `Config must include endpoints with filePaths and files`, and Node init did unless `filesDir` was set.
- `SeedConfig.schema` takes a `SchemaFileInput`: a schema file whose `$schema`, `version`, `metadata.createdAt`, `metadata.updatedAt`, `enums` and `migrations` may be left out. `version` defaults to 1. A schema object without `$schema` used to fail with `Schema name is required` although `metadata.name` was set.

- **A changed schema with a pinned `id` loads at init even when its `version` didn't change.** Before, `config.schema` whose content changed but whose `id` and `version` matched a schema file the device had stored loaded that old file and dropped the new content without an error: new models were missing (`Failed to save property …: no schema found for …`) and removed ones stayed. Now the stored file is overwritten with a console warning to bump `version`. `importJsonSchema` with a complete schema throws `Schema … already exists with different content` in that case instead of loading the old file.
- Models a schema drops are unlinked from it when the schema loads, whether the change came with a new `version` or not. Before, a new version kept every model the previous one had linked. The models' rows and items stay. Schemas with draft edits are left as they are.
- Client init's "continue in a test environment" checks read `IS_SEED_DEV` only where a `process` global exists. In a browser without Node polyfills, a missing app DB or a failed config save threw `process is not defined` instead of its own error.
- The browser entry (`dist/main.js`) no longer has a bare `import 'fs'` left over from tree-shaking. Vite warned about it, and webpack and Turbopack failed to resolve it without an `fs` alias.
- `item.publish()` works on the direct-EAS (EOA) path. It failed every time with `Creating attestations for … failed: Cannot set property seedUid of #<Item> which has only a getter`, because it handed `@seedprotocol/publish` the item's raw instance, where `seedUid` can't be assigned, instead of the item it was called on. `publishItem(item)` was not affected.
- **A property edited after its seed is published attests on the next patch `publish()`.** The edit went into a new draft row, but the property kept the published row's `localId` and `uid`, so patch Publish skipped it as already attested and the edit never reached EAS. Basic, Relation, List, Image, File, Html and ItemStorage properties were affected. Each later edit also added another draft row, and setting the published value back left the draft in place. Publish now also points a property at its newest draft row when its context still names a published one (another tab's edit, or a metadata update the browser's live query dropped while the property was saving).

### Commits

#### Breaking

- fail browser init when the database can't persist to OPFS (30bb7697)
- make @seedprotocol/vite an optional peer (cc594f7e)

#### Features

- default filesDir and endpoints, accept a minimal schema (4f6e8a8d)
- re-export drizzle-orm as @seedprotocol/sdk/drizzle (887d8a90)
- next: add @seedprotocol/next with withSeed (bc640fa8)

#### Fixes

- arweave: time out status checks and fall back to other gateways (b6c851f5)
- point an edited published property at its draft row (8fe23390)
- a Model only takes the row with its own id (f178b936)
- catch child-instance load failures in entity live queries (c1691717)
- resolve property schema UIDs by exact definition everywhere (c0dffe4d)
- don't read a tx id out of a bytes32 value (22b14058)
- publish properties under the schema for their exact definition (0de66bb5)
- pass the reactive proxy to the publish executor (4ff701d8)
- read IS_SEED_DEV only where process exists (3c8f7752)
- load a changed schema whose pinned id and version match the stored file (cd7153a8)
- schema import writes each model and property row once (48fad4fb)
- model and property inserts no longer fail when the row exists (f77a1e01)
- keep the Node platform out of browser bundles (7d2e8dab)
- keep schema-file model fields when merging model rows on load (264d2764)

#### Other

- note why legacy bytes32 storage_transaction_id attestations aren't recovered (ee460f98)
- resolve the Node filesDir in the Node platform (ecd8cff7)

## 0.7.5 (2026-10-17)

- Browser bundles no longer include the Node platform. It shipped as an unused lazy chunk of about 150 KB gzipped (libsql and its migrator), and broke webpack and Next.js server builds. The Node platform now loads through `#seed-node-platform`, a `package.json` `imports` entry that maps to the browser platform under the `browser` condition. Platform selection at runtime is unchanged, so jsdom still gets the browser platform.
- **Breaking: `@seedprotocol/vite` is an optional peer dependency** instead of a dependency, so installing the SDK no longer installs Vite, Rolldown and `vite-plugin-node-polyfills`. Apps that import `@seedprotocol/sdk/vite` must install `@seedprotocol/vite` themselves.
- `withSeed` from `@seedprotocol/sdk/node` is deprecated in favor of `@seedprotocol/next`, which covers Turbopack and sets the cross-origin isolation headers.
- Publishing Html with an embedded `data:image/...` image no longer fails with `ItemPropertySaveValidationError` before anything uploads. Each embedded image's bytes are written to the images folder instead of into its Image seed's `storageTransactionId`, a Text property limited to 255 characters, which any real image's data URI exceeds. This broke in 0.7.2, when `save()` began throwing on validation errors; before, the save was rejected without an error and publish uploaded the image from the property's in-memory value.
- **Breaking: Number properties publish as `string <name>` instead of `uint8 <name>`** (ADR 0010), so values above 255, negatives and decimals publish; before, they failed with `Failed to encode property`. A stored value that isn't a finite number fails publish validation with `publish_invalid_number`. Published Number values are under a new EAS schema UID. Items published before keep their `uint8` attestations until the property changes, and sync still reads `uint8`, other integer and numeric string attestations into Number properties.
- **Breaking: sync skips a property attestation whose EAS type doesn't fit the local property's type** (ADR 0008, ADR 0010), with a warning. A Number takes integer types and numeric strings; other types take the type publish writes for them. Before, any attestation with a matching name was stored.
- Synced Date values are stored as ISO strings. Before, sync stored the indexer's `{"type":"BigNumber","hex":…}` text. Rows synced before stay as they are.
- `getPublishPayload` attests `0` and `false`; only a missing or empty value is skipped.
- `summarizePublishWork` returns `uploadSizes`, the size of each upload, next to `uploadCount` and `uploadBytes`. `@seedprotocol/publish` uses it to price Arweave uploads per transaction.
- **A new draft gets the owned address when it is the only one.** With owned addresses set and no publisher getter (or one that returns nothing), a new draft with exactly one owned address is now that address's. With several it has no publisher until the next wallet connects (see the ownership entry above); register `setGetPublisherForNewSeeds` to give it one at creation.
- **Breaking: a File property's value is its content URL**, a blob URL in browsers and a `file://` URL in Node, after a save and after a reload. Before, it was that URL right after a save or load and then turned into the file's text a moment later. Read the file through the URL (`fetch` in browsers, `fs` in Node) for its contents.
- `modelProperty.unload()` releases the caller's hold. A model's properties are owned by the model and keep running until it's evicted; a property only the app holds is stopped when its last holder unloads it. Before, unload stopped the shared instance for every holder, including its model.
- `item.unload()` releases one holder. `Item.create`, `Item.find` and `createById` give every caller the same cached instance, and unloading it stopped it for all of them (another hook showing the same item stopped updating). It's stopped once the last holder unloads it.
- **Node processes exit on their own after `client.stop()`.** Two invalidation `BroadcastChannel`s were left open after posting (10 `MessagePort` handles), and the 10 s fallback timers in `Model.create` and the model and schema reloads weren't cleared when the wait finished first. Scripts no longer need `process.exit()`.
- `client.init` after `client.stop()` initialises again, with the new config. Before, it resolved without doing anything (the stopped client still reported itself initialised), and with that fixed it would have hung, since a stopped client can't restart; init now starts a new one. `client.isInitialized()` is false after `stop()`.
- `client.init` no longer creates `<cwd>/.seed`. It was created on every Node init even with an absolute `filesDir`, so init failed with `EACCES` from a read-only working directory, such as a packaged Electron app's `/`. A relative `filesDir` still resolves under `.seed`, and is created when the database is prepared.
- A `dbConfig.dbUrl` whose folder doesn't exist yet works: the folder is created. Before, init failed with `Unable to open connection to local database …: 14`.
- **`Item.create` leaves nothing behind when it rejects.** File, Image, Html and ItemStorage values are saved after the item's rows are written, and a failure there (a rule the value breaks, an ownership refusal, the item not loading in time) used to leave a draft holding the other values, so a retry made a duplicate and `useCreateItem` reported an error for an item that existed. Now the draft, the storage seeds it points at and their files are removed before the error is thrown. A value that breaks its property's rules rejects with `ItemCreateValidationError` and its `problems`, like the other values; before, Html rule failures were a plain `Error`. `createNewItem` also removes its rows when one of its inserts fails.
- **Breaking: a draft that has never had a publisher is owned whatever the owned addresses are.** It was made with no wallet connected and belongs to no wallet yet: it's editable, `addressFilter: 'owned'` lists it, and the next wallet to connect becomes its publisher (`claimUnpublishedDrafts`, which `@seedprotocol/publish`'s `setPublishWallet` calls). A draft with a publisher keeps it: it's owned only while that address is, so it's hidden and read-only while another wallet is connected and back when its own reconnects. Before, a draft with no publisher was read-only and left out of owned lists whenever any owned address was set, as after a reload before the wallet reconnects, or in a Node script whose config lists several owned addresses. `isSeedRowOwned`, `ownedSeedsSql` and `isItemOwned` follow the new rule.
- Version and property rows take their seed's publisher. Before, versions and new property rows took the publisher getter's address, and rows written by an edit had none, so connecting another wallet claimed them although their seed belonged to someone else. `claimUnpublishedDrafts` now claims versions and property rows only with their seed. On first init after upgrading, a one-time fix gives existing rows without a stored attestation their seed's publisher. Before it, `@seedprotocol/query`'s local reads, which use a row's publisher as its attester, could leave out a published value whose row another wallet had claimed.
- Assigning a property the value it already has no longer adds a draft row next to a published value. The unchanged-value check compared `null` in the DB with the `undefined` that plain values pass for their ref fields, and compared the stored model type with the lowercased model name (`blogpost`), which isn't the stored form for multi-word or acronym names (`blog_post`).
- Property rows written by an edit or an ItemStorage save store the model's EAS name as their model type (`blog_post` for BlogPost), like the rest of the DB. Before, they stored the lowercased name until the next `canonicalizeModelTypes` run.
- `getEasSchemaUidForModel` asks EAS for the model's EAS name (`blog_post`), the name publish registers. Before, it asked for `blogpost` and missed multi-word and acronym models when no `model_uids` row covered them.
- `applyArweaveL1TransactionIdLocal` is deprecated: it made local storage ids differ from the attested ones. `restoreDataItemIdsOverwrittenByL1` undoes it.

### Commits

#### Breaking

- a File property's value stays its content URL (4cb17801)
- drafts with no publisher belong to the next connection; rows follow their seed (db96967e)
- sync decodes numeric values and checks property types (ebae8bfc)
- publish Number properties as string <name> (84a53414)

#### Features

- nameMatch sets how strictly EAS names match models and properties (504ad1f7)

#### Fixes

- ModelProperty.unload releases the caller's hold; models own their properties (a6539934)
- Node processes exit after client.stop(); init works after stop (53be3817)
- Item.unload releases one holder instead of stopping a shared item (31850c42)
- a rejected Item.create leaves no draft behind (b4ef23b5)
- an unchanged value doesn't add a draft row over a published one (42e12d58)
- keep Html-embedded image bytes in a file, not storageTransactionId (4cc00200)
- a new draft gets the owned address when it is the only one (e7f64ede)
- type the synced property value as a string (bd11f8e7)
- publish: local storage ids stay the attested data item ids (50818a6d)
- publish: Arweave and testnet gas estimates; upload docs (b5873c52)

#### Other

- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

## 0.7.4 (2026-10-15)

### Commits

#### Breaking

- Item.create rejects unknown models, unknown keys and invalid values (d51311c8)

#### Features

- warn when names collide on EAS; document migrations as not applied (6f2c1107)

#### Fixes

- schema import renames a property only when its id matches (7d8b0be9)
- bring stored model types to their easName form after init (c28112f9)
- sync matches EAS names to local models and properties (5f24b88f)
- publish, react: one easName for every name that reaches EAS (eec5ded5)
- remove other accounts' attestation rows an older sync stored, offline (4cd6cf42)
- publish: addresses saved by init are announced; connecting keeps watched addresses (a8029bcc)
- a sync interrupted by a closed tab no longer stays in progress (49a3869f)
- retry the startup EAS lookup and failed syncs when back online (39393f40)
- creating items and saving files works offline (d11ca6b8)
- typing into a property no longer drops keystrokes (60d3f6ba)
- an edited draft outranks synced values older than the edit (a3522102)
- uploads with the same file name no longer overwrite each other (76f26b3d)
- eas, query: only a seed's attester can add its versions and properties (73e23776)
- Schema.destroy keeps its live query from re-creating models (252967bd)
- isSqliteUniqueConstraintError ignores stack frames (6f8ccafe)
- Schema.destroy deletes every version's file, by parsed id or name (0c4afafb)
- a schema row takes a newer version file's id along with its data (9393aae4)
- client.init uses config.dbConfig on Node (b29b9bef)
- parse a multi-word schema name's file id, and match file version on id lookup (7495d5eb)
- react: hyphenated schema names aren't cut at the last hyphen (96745809)
- Schema.destroy deletes the schema's files so it stays destroyed (55e381f8)
- unload() stops an entity only when its last reference is released (b985633c)
- a lookup by id overlapping Model.destroy doesn't re-cache the model (d9c75537)
- one lookup for a property's validation rules, with the stored-schema fallback (7929b9a0)
- List of Relation reads back as an array (6cb1e8f0)
- File property strings mean what they look like, and read the same after reload (24bf5ed1)
- background draft saves report failures as lastSaveError (1b00f135)
- declare Schema.name and ModelProperty.id (39f5906e)
- saveNewVersion writes a schema file that loads again (619731d0)
- Date values validate, and enum isn't given Text's default length limit (d3784321)
- enforce validation rules on properties defined in code (d028b4ad)
- validation rules combine instead of replacing each other (e816898b)

#### Other

- liveQuery JSDoc says which query forms each platform supports (c656708e)

## 0.7.3 (2026-10-14)

### Commits

#### Breaking

- remove the ./node property decorators (b47e7d7a)

#### Features

- item.publish() delegates to an executor @seedprotocol/publish registers (09335838)
- export the error classes and types the docs reference (3856064e)
- whenDeferredSchemaReloadsSettled for renameModelProperty's reload (e598609e)
- whenDeferredSchemaReloadsSettled for renameModelProperty's reload (9ba79f4c)
- announce every ZenFS file write to other tabs, coalesced (e3399336)
- one-time migration writes legacy ItemStorage rows to their files (c494480b)
- arweave: one read-side seam for Arweave content (8b84c616)
- build publish uploads as raw data; Content-SHA-256 is SHA-256 (bbcb0ab4)

#### Fixes

- ModelProperty.create rejects when its row is not written (d5203423)
- destroy() rejects on failure and works when items have values (f864a602)
- loaded items take the publisher claimUnpublishedDrafts stamps (9c29fdc4)
- ItemProperty.destroy checks ownership and deletes only its item's rows (b5496302)
- assigning a property on an item you don't own is refused and rolled back (1dfe2061)
- client.init keeps one config, applies new addresses, and onReady fires late (af1009f3)
- a throwing event listener no longer breaks the code that emitted (78fa6bc4)
- filesDir '.seed-alt/x' is resolved under .seed, not as a .seed path (b1c5d83d)
- PropertyDataType accepts plain strings like 'Text' (2560e530)
- require() loads the ESM build instead of a separate CJS build (02633c19)
- find drizzle migrations and the SDK root from any working directory (c3be1cf0)
- loadEasSdk falls back to import() outside plain Node (1156f764)
- import on Node without the node-eas-lodash hook (c07bba90)
- schema updates reach cached ModelProperty instances (3d8ac0ed)
- default readyTimeout is 15s everywhere (a4ef917d)
- client.init fails when the configured schema cannot be loaded (c6cd9cff)
- type create() without waitForReady: false as a Promise (9cb1bdc7)
- cached ModelProperty takes the renamed row's name after renameModelProperty (77038f83)
- CommonJS entries load and match their types (1e5d325c)
- schema reload renames the property row after renameModelProperty (4a73aa89)
- Model.all waitForReady keeps models that are ready (ca4f6d84)
- Model.create waitForReady waits for its properties to exist (3cbe77e1)
- react: addressFilter 'owned' lists what isItemOwned says is owned (f31e5991)
- browser: don't cut off bytes another context wrote when writing a stale OPFS file (c90c9ccc)
- browser: overwrite OPFS files with shorter content without leaving the old tail (e746ff32)
- clearer error when a saved ItemStorage row vanishes before the lock (8baf122f)
- lock each ItemStorage file across saves and legacy-row conversion (fea40332)
- saving over a legacy ItemStorage row marks it refValueType 'file' (b83bfe7f)
- clear verbatim ItemStorage content from the row once it is in the file (b403e625)
- ItemStorage values given at creation are saved to their files (5ea3d80f)
- publish never swaps a published ItemStorage row for an older local file (7a1cbd9f)
- download worker saves every composite child where the SDK reads it (6297e2e1)
- ItemStorage save sets its file path at once; publish no longer drops children (4d2c0de0)
- batch Content-SHA-256 lookups and verify downloaded files (c01e41d5)
- keep binary children of composite uploads intact (0004415a)
- unknown storage data types live in files/, one shared helper (99f8cb9d)
- set Content-Type for all common upload types, shared with downloads (fb03fec5)
- settle file downloads deterministically when the worker fails (5f041edd)
- download worker routes by Content-Type, keeps non-images out of images/ (98b22ecc)
- serialize withTabLock sections in-process without Web Locks (689f24f9)

#### Other

- create publish L1 transactions with bounded concurrency (cc94796d)

## 0.7.2 (2026-10-11)

### Commits

#### Fixes

- import getLatestVersionRow statically in Item (f7a301a7)
- don't treat local ids that start with 0x as EAS uids (1a8f5739)

## 0.7.1 (2026-10-10)

### Commits

#### Features

- query: look up seeds of a schema by uid prefix (2d8d129d)
- Item.peekReady / ItemProperty.peekReady read the instance cache without a hold (4aebbe52)
- seed:property/<name> placeholders in Html resolve to the property's upload (ef4c28e9)

#### Fixes

- rewrite Html-embedded image src by splicing, not re-serializing (7c4857bc)
- a model evicted before its property ids are applied creates no properties (c2b04bd4)
- work in flight when a schema is evicted can't bring its models back (a72a31fc)
- publish: publish the full graph of related drafts (c115dc30)
- Html-embedded images no longer overwrite the Html seed reference (329a0a63)

#### Other

- eas, query: drop the slow schema-name join from attestation reads (b0fcdb37)

## 0.7.0 (2026-10-08)

### Commits

#### Breaking

- stop ModelProperty.save() from looping until out of memory (e61baa78)

#### Features

- keep other tabs current with relayed events and file changes (4492a824)
- elect a leader tab for automatic EAS sync and the L1 worker (1d828074)
- record version revocations in versions.revoked_at (09649128)
- require a schema when a model name is ambiguous (631df2d5)
- record each item's model and resolve models by (schema, name) (982b1a6b)

#### Fixes

- keep stored addresses on empty init only when another tab leads (255efe3d)
- stop tabs clobbering downloaded files and excluded transactions (c96174ea)
- a finished property write stays in its Model's properties (f6a65d2f)
- key the EAS model schema lookup on its own name (7d9ee480)
- don't wipe stored addresses when init has none (4a8b873f)
- take turns on init writes across tabs (afe7661f)
- run migrations one tab at a time, each atomically (dc0681ac)
- getPropertySchema falls back to the properties table for runtime properties (3e52ad66)
- publish: co-publish images embedded in related drafts' Html (0c47942e)
- getPropertySchema finds runtime properties on schema-file models (61449bee)
- release OPFS file locks when worker writes fail (816ddc06)
- mount OPFS when another tab or worker is using the database (bc4ab475)
- Model.create never returns a cached model with a different id (875f80b1)
- keep a stale seed row from restoring the old uid during republish (4ac991b4)
- report Html-embedded images pointing at unpublished image items (1309d536)
- retry a Model's DB id on the timer only while it isn't writing (4922c693)
- publish: a patch publish's existing version uid is not recorded again (ecce0332)
- keep resolving an entity's DB id after it goes idle (cc5da02f)
- full-snapshot publish records every property on the new version (0c4bc3fb)
- publish: publishing a reference to an unpublished item fails (3c05c13c)
- Item liveQuery watches its seed row by local id (090cbd2e)
- store attestation_raw and property values without SQL escaping (4b18563c)
- republishing an unpublished item creates a new seed (c4b1a3f4)
- query: leave out seeds whose versions are all revoked, in both sources (fa843e09)
- bind synced property values instead of inlining them in one INSERT (3486a91a)
- getVersionData seedLocalId filters on versions.seed_local_id (b7893f66)
- wait for in-flight writes before Schema.destroy deletes rows (4863469e)
- drop findUniqueModelName's schema-context check (65c907e2)
- keep a ModelProperty's schema name through initializeOriginalValues (b8198d7b)
- mark derived ItemStorage rows and keep local edits out of them (82a4fb8b)
- keep a metadata row's unpublish stamp until EAS reports a revocation time (ea6348c3)
- persist property storage settings in the properties table (b1e48359)
- resolve Relation targets in the owning model's schema on property writes (71411e34)
- derived ItemStorage rows follow their storage_transaction_id attestation (caa1bd05)
- don't rewrite model properties that are already persisted (79967a31)
- readers prefer a live metadata row over a newer revoked one (b2432397)
- replace a seed's local revokedAt stamp with EAS's revocationTime (7d850eed)
- insert synced versions with bound parameters; skip unresolvable seeds (d4e27804)
- stop async work from sending to evicted Model/ModelProperty actors (bfdc187e)
- restore the drizzle snapshot chain for migrations 0011/0012 (7c6cc228)
- propagate property revocations and replacements to stored metadata (13ddb58d)
- scope EAS sync lookups and related seed UIDs to one run (99f27e1a)
- fetch relation targets through the main sync's version/property path (f24ba79d)
- eas: select revocationTime on version and property attestations (8a7f891d)
- sync versions for already-stored seeds, not only new ones (30f2083e)
- log failed database writes with console.error (e59153d7)
- eas: skip revoked attestations when picking canonical property (b8b95590)
- resolve item ownership by localId before falling back to uid (d149b565)
- scope loadOrCreateItem's schema-file fallback to the item's schema (e14a68de)
- scope metadata property_id and publish-payload lookups to the item's model (ce3a1cae)
- keep loadOrCreateItem's property schema lookup within the item's schema (87547d0d)
- stop Schema.create leaking an unhandled rejection on ready timeout (3f3a6c81)
- scope Item property resolution to the model's schema (9a72d9eb)
- don't adopt another schema's same-name model row on import (78303135)
- treat an existing images/ filename as a file reference in saveImage (53f07d66)
- store schema validation errors and stop model/schema re-validation loops (8a0023fe)
- record addModels failures and process queued addModels requests (8fc68250)
- let addModelsMachine reach its final states (ba79f524)
- save markdown frontmatter properties; run markdown import tests on the app DB (c8391f0c)
- read File values with Blob.arrayBuffer in saveImage/saveFile (47c8f7a1)
- accept Blob values for Image properties in validation (765bf8b6)
- keep the model name, not the model type, on loaded ItemProperties (ef5628b8)
- stop the property creation write from clearing required (d71e9b1b)
- stop rejecting edits to runtime-shaped property definitions (8b65a152)
- evict cached models and properties in Schema.destroy (caa421fb)
- eas: include query inputs in EAS fetchQuery keys (b6793cab)

#### Other

- share one browser QueryClient per page (ad826a5c)
- index ModelProperty.getById by id instead of scanning the cache (16beffe8)
- cache EAS schema lookups, including misses (6daf71c0)
- Remove leftover root test-drizzle.config.ts (e72ace09)
- Remove drizzle:track, superseded by drizzle:update (d7e01209)
- Resolve models by EAS type in property-id and storage lookups (c8933451)
- Batch EAS sync's IN-list reads and seed inserts under SQLite's 999-variable limit (a7de52c7)
- Skip revoked versions when picking a seed's latest or latest published version (f1f5c773)
- Replace stale update-drizzle.sh with scripts/update-drizzle.ts (d89d9a01)
- Guard the versions insert batch against SQLite's variable limit (cf45c45c)
- Resolve synced seeds' models by snake_case type, not startCase (55ce6ca3)
- Local query data source follows local revoked_at columns (94c1fa99)
- Apply getItemProperties edited filter to each property's current value (b77c3c68)
- Stamp derived ItemStorage rows when unpublish stamps their source (5f09492a)
- stop ModelProperty parsing every schema file to find its schema (549a7b2a)
- hash schema content once when deriving import ids (05d5c7aa)
- remove addModelsMachine and schemaMachine's addingModels state (6643dc07)
- Skip re-applying unchanged schema files on client init (692ff205)
- Don't treat orphaned models as unlinked stubs; fix tests that relied on adoption (bfd4bdd6)
- Scope model lookups by name to the schema (53306a49)
- delete dead fromCallback actors and fix waitForDb's interval leak (c06683c6)
- drop unused destroy-progress state from entity machines (9c27162c)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.9 (2026-10-03)

### Commits

#### Breaking

- publish: encode multiPublish with publishIndex for SeedProtocolExtension (69318de1)

## 0.6.8 (2026-10-03)

### Commits

#### Features

- publish: verify the publish chain before writing; hold EAS sync until the chain is known (5f4fc0ee)
- record the EAS chain in the local DB and refuse cross-chain writes (7d8af9d5)
- read EAS from the configured chain and register base schemas on new chains (91e0290e)

#### Fixes

- publish: attest list relations under one EAS name (55d6cbe2)
- publish: treat relations to published seed uids as already published (8133d761)
- resolve metadata property_id from schemaFileId instead of Number() (39892ccc)
- case-insensitive data types and visible save failures in Node (d0159c85)
- publish: normalize EAS schema types and refuse automation registration (b68fef38)

#### Other

- Lots of bug fixes (a3a7f146)
- Final changes (b9f033a2)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Features

- publish: add PublishedBy batch sidecar attest/revoke/query APIs (14233083)

#### Fixes

- publish: support Node server publishes without a browser Thirdweb client (7ef2fe66)
- stop Rollup unbound Arweave re-exports in constants (12d7827b)

#### Other

- Final edits (687d320b)
- Add Arweave gateway circuit breaker for probe and image fetches. (8f572026)
- Harden Model lazy-import for Rollup and typed client init failures. (f9ef876d)
- Add ensureImageLocal and progressive SeedImage Arweave fallback. (14f0156f)
- Keep Node builtins and CJS keccak off the Seed browser graph. (3bc60ae1)
- Fix silent dbInit hang when Chrome kills sqlocal's module worker. (bda9edb9)
- Stop treating a failed client init as ready. (b32df5e7)

## 0.6.3 (2026-09-25)

_Also covers 0.6.1, 0.6.2, published from commits in this range._

### Commits

#### Other

- Fix Item proxy descriptors and FieldMapper stale mapping writes. (e26a927f)
- Fixing item ownership bugs/gaps (2539c65c)
- Adding publish cost estimator tooling (6d2f170c)
- Fixing bug so uid doesn't depend on CreatedAttestation (5e64192b)

## 0.6.0 (2026-09-22)

### Commits

#### Features

- mapping: add resolve jobs, URL classifier, and AV media roles (ac9ef29c)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- add client.removeLocalCopiesForAddresses local purge (236098a0)
- query: share sync parse/canonical helpers and close related pickLatest gap (e5729faa)
- query: add local/remote/auto source adapters for Seed JSON reads (009fac0e)
- feed: emit media URLs for Image relations, not EAS links (339baf07)
- arweave: classify EAS explorer URLs and resolve RSS image refs (cd3ae146)
- arweave: prefer proxyBaseUrl as http-proxy gateway path (13775b17)

#### Fixes

- force Rollup exit and type removeLocalCopies rows (346899b9)

#### Other

- Updating Github repo display (96743dd2)
- Mark cli, webpack, and ghost as experimental private packages (f6a60eac)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- webpack: extract @seedprotocol/webpack config helper package (af1c49d8)
- vite: extract @seedprotocol/vite bundler plugin package (60c87aed)
- resolve Seed gateway endpoints for HTTPS and sidecar paths (02b52271)
- add DEFAULT_SEED_FEED_HYPER_KEY constant (1d15344b)

#### Fixes

- guard BaseDb readiness before platform classes init (425883c3)
- extract generateId and stabilize helpers facade exports (4478fb5f)
- re-export gateway env helpers and use primary-aware fallbacks (ef8856ae)

#### Other

- replace setPlatformClass with instance + static facade (0bca44b7)
- route GraphQL through tier-1 packages and drop duplicate tree (48754cea)
- re-export eas/arweave and shrink runtime dependency surface (32ee1103)
- Archive experimental RPC server and finish 0.5.0 cleanup. (8e49add9)

## 0.5.0

### Changed

- Extracted `@seedprotocol/eas` and `@seedprotocol/arweave` Tier-1 packages; SDK re-exports preserve the public API.
- `drizzle-orm` and `xstate` are now peer dependencies (consumers must declare them explicitly).
- Removed unused runtime deps: `globals`, `ethers`, `better-sqlite3` (Vite-only references moved to devDependencies).
