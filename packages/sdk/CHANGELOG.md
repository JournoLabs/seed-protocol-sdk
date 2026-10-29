# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- New `getPublishPayload` / `validateItemForPublish` / `getPublishGraph` option `backReferences` (`PublishBackReferences`): `'link'` attests a relation back to an item the publish is still creating (both sides of A ↔ B) and fills it with a reference; `'defer'`, the default, leaves it for a later publish as before.
- `getPublishPayload` gives a reference into a list property `listElement: true` and the `elementIndex` it fills, one entry per position where the list holds the draft, so a draft listed twice fills both (see the @seedprotocol/publish changelog).
- Schema files the SDK writes use `$schema: 'https://seedprotocol.io/schemas/data-model/v1'` (was `https://seedprotocol.org/...`, a domain the project doesn't own). Files with the old URL still load, and `$schema` no longer counts toward a schema's content hash, so a stored file with the old URL matches the same schema today instead of failing with "already exists with different content". Each schema is re-applied once after upgrading, because the hashes stored in the database change.
- Listing a directory in the browser (`Schema.load`, `listCompleteSchemaFiles`, `fs.promises.readdir`) skips a file another context removed between the listing and its stat. The removal surfaced as `TypeError: Cannot set property message of ... which has only a getter`: OPFS's `NotFoundError` reached ZenFS unconverted, and ZenFS failed to append to its read-only message. The OPFS mount's `stat` now fails with `ENOENT` for a removed file and `EIO` for other OPFS errors.
- **Breaking:** `client.init` called again leaves the stored addresses alone, whatever `addresses` it is given; change them with `client.setAddresses`. In 0.7.13 a repeat init with the same config replaced them with a different non-empty set and kept them for an empty one, so whether a remount changed the addresses depended on what the host passed. `SeedProvider` and `SeedClientGate` call `setAddresses` when their `addresses` change. The init config conflict message no longer suggests init for new addresses.
- **Breaking:** `getUnpublishedRelatedItems` is removed. New `summarizePublishUploads(item, { publishMode })` returns its `unpublishedRelatedItems` together with `uploadCount`, `uploadBytes` and `uploadSizes`, from one read of the publish graph and file sizes only. Publish's `checking` step uses it for the upload size limits.
- `ItemPublishOptions` documents `confirmUpload` and `maxUploadBytes` (see the @seedprotocol/publish changelog).

## 0.7.13 (2026-10-29)

- New `client.resetLocalData({ otherTabsTimeoutMs, filesDir })` (browser) deletes the database and every file under `filesDir` from OPFS and resolves with `{ deleted, failed }`: an entry it can't remove (a file another tab holds open) is listed in `failed` with the browser's error, and the rest are still removed. It stops the client from any state, including after a failed init, posts `close-db` to the other tabs of the database, waits up to `otherTabsTimeoutMs` (default 10 000) for them to close it, and unmounts the file system, so `init` works again without a reload and starts empty. An `init` during the reset waits for it. Each coordinating tab now holds the Web Lock `seed:open:<db>` in shared mode while its database is open; the reset takes it exclusively. A tab that hears `close-db` stops its client and unmounts its file system; it doesn't reload. The client snapshot's new `context.stopReason` (`ClientStopReason`: `'stop' | 'reset'`) says why a stopped client stopped. localStorage is left alone (see `clearInAppPublishSession` in @seedprotocol/publish). In Node, `resetLocalData` throws.
- New `getPublishModels(modelNames, { schemaName, followRefs })`: the models a publish of items of those models attests, read from the loaded definitions with no seed, each with every property and its publish kind. It includes the storage models (Image, File, Html) storage-seed properties reach and, with `followRefs` (default true), the models relation and list properties name. A name with no model throws; a name two schemas define throws `AmbiguousModelError` unless `schemaName` is given.
- An edit that puts a property back to its latest attested value leaves no draft: when the outbox applies it, the property's drafts are deleted and the attested row is current again (ADR 0019, amended). `getPublishPendingDiff` and publish leave the property out. A property edited from A to B and back to A was listed with `currentValue` and `previousPublishedValue` both A, and the next publish attested A again. After sync has stored a newer value, going back to the old one is still an edit. Drafts written by an earlier SDK that equal the attested value stay until the next publish attests them.
- `getPublishPendingDiff` leaves out a property whose current value equals `previousPublishedValue`, compared by `propertyValuesEqual`: relations by the seed they name (a local id equals the seed's uid, the form a publish records), lists member by member in order. A pending edit back to the published value is left out before the outbox applies it.
- New `recordPublishRequest({ version, properties })` records one publish request's version uid and property uids in one transaction. Publish uses it, so a change-feed dispatch between the two writes no longer showed the version published with every property still pending. `updateVersionUid` and `applyPropertyAttestationUidsFromPublish` take an optional `{ db }` to write in a caller's transaction.
- New `publishRemovesValue(node, property)`: whether publishing an empty property of a publish graph node attests a removal (ADR 0021). `getPublishPayload` and the publish package's EAS schema check both use it.
- **Breaking:** a model or property whose EAS name is a word the Solidity ABI parser reserves (`view`, `event`, `error`, `storage`, `struct`, `function`, `indexed`, `returns` and the other visibility and modifier keywords) is refused when the schema file loads, and when code creates or renames one. EAS parses schema strings with ethers, so such a name could never be registered or attested; publish failed at the first encode. A schema file that has one now makes `client.init` reject with `<Model>.<property>: Property "view" publishes as "view", …`. A List of relations is exempt: it publishes as `<name><Model>Ids`.
- Recording a publish gives the seed, version and property rows that were unsealed drafts the address that attested as their publisher. They kept the publisher they were stamped with as drafts, so a draft stamped with the EOA and published by the smart account named the EOA, and the local query source reported it as the attester. A sealed row's publisher still never changes. `applyPropertyAttestationUidsFromPublish` takes `publisher`.
- **Breaking:** an Image, File or Html property whose file isn't found reads as `undefined`. Its `value` was the stored storage seed id (Html), the file name (Image) or `'No file found'` (File), which callers couldn't tell from content. New `ItemProperty.valueStatus` (`'resolved' | 'fetching' | 'missing'`, also on `IItemProperty`) says which case applies, and `missingFile` gives the path looked up. A missing property reads its file again when the file is saved (a download, another tab), announced through `FILES_CHANGED_EVENT`; it didn't re-read until something else changed its row. A property that keeps showing content it resolved before (an Html body fetched through its transaction) stays `'resolved'`.
- `client.init` called again with the same config and an empty `addresses` (`[]`, or no owned or watched) keeps the stored addresses; a different non-empty set still replaces them, and `client.setAddresses([])` clears them. It cleared them, so a host that passes `addresses: []` before a wallet connects lost the wallet's addresses when `SeedClientGate` remounted and ran init again.
- `client.init` after `client.stop()` with another `filesDir` uses the new directory. The file system kept the first init's directory, so the second init applied the first directory's schema files to the new database (`Schema.all()` returned both schemas), and file reads and saves went to the first directory.
- New `ClientNotInitializedError` (`code: 'CLIENT_NOT_INITIALIZED'`), exported from both entries (decision D36). `Item.find` rejects with it once `readyTimeout` passes without an open database, and client methods throw it after `client.stop()`. Both threw a plain `Error` with that message, which callers could tell from a load failure only by its text. The message is unchanged.
- `IItemProperty.save` takes `{ timeoutMs }`, like `ItemProperty.save`, so code holding an `IItemProperty` (such as `useItemProperty().property`) can pass it without a cast.
- `entityLoadError` is exported from `@seedprotocol/sdk/node`.
- The slow-save warning and the removed-event warning read `process.env.NODE_ENV` in the form bundlers replace, so a browser production build no longer logs them. They read it through `globalThis.process`, which bundlers leave alone, so a bundle with no `process` global, or with the `process` polyfill and its empty `env`, counted as development. With no `process` and no replacement they now stay quiet.
- A Schema loaded after a ModelProperty edit or rename, or after a model was created at runtime, starts as a draft with those edits, read from the rows' `is_edited` flags, so `saveNewVersion()` writes them to the next version file. It loaded with no edits and returned `''`, leaving a rename made while no Schema instance was loaded (or before a reload) in the database but never in a schema file. `saveNewVersion` now clears `is_edited` on each saved property's row even when no instance of the property is cached.

### Commits

#### Breaking

- refuse model and property names that publish as a reserved ABI word (aa4fcaf5)
- a file-backed value whose file is missing reads as undefined; add valueStatus (3942b9c7)

#### Features

- client.resetLocalData deletes the local database and files, stopping other tabs (97e82b67)
- publish: ensureEasSchemasForModels registers a model's EAS schemas without an item (e9baae43)
- an edit back to the attested value leaves no draft (6f39e4e8)

#### Fixes

- publish: ensureEasSchemasForItem asks only for schemas the publish attests (43196475)
- publish records the attester as publisher on draft rows (1d07b478)
- repeat client.init with empty addresses keeps the stored ones (f57dc2cd)
- init after stop with another filesDir moves the files root (5c2cda3d)
- ClientNotInitializedError (D36), IItemProperty.save timeoutMs, entityLoadError on ./node, production check bundlers replace (4a5bf4ae)
- a Schema loaded after a property rename saves it in saveNewVersion (6dcae17a)

## 0.7.12 (2026-10-27)

- `TabLockTimeoutError` is exported from `@seedprotocol/sdk/node`. Node throws it when a storage-value or ItemStorage save waits longer than the lock timeout (60 s), through Web Locks on Node 24.5+ or the in-process fallback before that.
- When `save()`, `Item.create` or a delete rejects with `OutboxOpFailedError` for a missing relation target or a staged file that was never written, its `cause` is a `RelationTargetError` (with `targets`) or a `StagedValueMissingError` (with `path`), rebuilt from the op (decision D31). The two classes were exported, but no caller ever received an instance. `errorName` is unchanged. `Item.create` now goes through the same rethrow as `save()`.
- The local query source's `readStorageBody` finds the Html body on disk for the value query hydrates: a gateway URL or `ar://` link (the storage seed's `html/<local id>.html` by its `storageTransactionId`, else a download named after the transaction) or, with `relations: 'uids'`, the storage seed's uid. It looked for `html/<value>.html`, which never exists for those values, so every local read of an Html body went to a gateway.
- `ItemPublishOptions.dataItemSigner` is typed: an object with an `address` and `signMessage`, such as an ethers `Wallet` or a @seedprotocol/publish `SeedSigner`. Any value type-checked through the index signature.
- New `entityLoadError(instance)`: the error an entity's last load failed with, while its `status` is `'error'`.
- Emitting `syncDbWithEas` or `fs.downloadAll.request` on `eventEmitter` warns once outside production that nothing handles it any more, and what to call instead (`client.syncFromEas()`). Both did nothing silently since the SDK stopped listening for them.
- `client.removeLocalCopiesForAddresses(addresses, { includeUnpublished })` keeps a local copy that holds unpublished edits (a metadata row with no attestation uid) or a pending outbox op when its publisher is still an owned address, and lists it in the new `keptSeedLocalIds` (decision D24). It deleted those with the rest, so edits not yet published or applied were lost. `{ includeUnpublished: true }` removes them too.
- An automatic EAS sync (startup, address change) merged into a run that a `client.syncFromEas()` call started is retried when that run fails, like one that runs on its own. The retry was decided by the first request's source alone, so the automatic part was dropped.
- On Node, live queries complete when the database closes (`client.stop()`, `BaseDb.close()`). Their poll kept running on the closed libsql client, so subscribers got a `Failed query: select …` error at shutdown.
- On Node, `entity_changes` is pruned like in the browser: rows older than 10 minutes, when the database opens and every minute after (on a timer that doesn't keep the process running). Node wrote the trigger rows and never deleted them, so the table grew without bound.
- Sync records no conflict for an Image, File or Html draft, as ADR 0019 says for storage values; the draft still stays the value. Only edits still in the outbox were exempt, so a saved storage draft got a conflict when sync brought a newer attestation.
- **Breaking:** `Item.create` checks its initial Relation and List-of-Relation values like an assignment does: a local seed id with no seed rejects the create (`Relation target not found: <id>`, the op's `errorName` is `RelationTargetError`), and a target whose own create is still pending makes it wait. It stored the dangling id. Attestation uids and a relation to the item itself pass.
- `ItemProperty.save({ timeoutMs })` rejects with the new `OutboxSaveTimeoutError` (`code: 'OUTBOX_SAVE_TIMEOUT'`, the queued op's `opId`) after that long (decision D30). Nothing is cancelled: the op stays queued and applies once a leader tab drains the outbox. Without `timeoutMs` a save still waits with no limit, and outside production one still waiting after 10 s logs a warning naming the property. Exported from both entries.
- Publish waits only for the pending outbox ops on the seeds in its graph (ADR 0019), reading the graph again if any were pending, since they can change which seeds it reaches. It waited for every pending op in the database, so one stuck op on another item held every publish. `getPublishGraph` does the waiting, so code that calls it directly gets the same behaviour.
- The local query source (`createLocalQueryDataSource`) filters `listSeedsBySchemaName` by `attesters`, matching the seed's attester from `attestation_raw`, else `publisher`, in any case, so `queryBySchema(…, { attesters, source: 'local' })` returns what the remote source does. Its `listSeedsByUidPrefix` is removed with the `QueryDataSource` method (**Breaking** in `@seedprotocol/query`).
- `ItemProperty.storagePropertyName` is the name new metadata rows are stored under: `authorId` for a single Relation `author` (it returned `author`), `authorIdentityIds` for a List of Relation. JSDoc corrected for `SeedConfig.entityCache.unloadGraceMs` (Schemas, Models and ModelProperties never unload for lack of holds; with 0, an instance that never had a hold is kept), `Item.unload`, `ItemProperty.unload`, `ItemProperty.saveValidationErrors` (cleared by the next assignment) and `Schema.find`.
- **Breaking:** `Item.find` called before `client.init` (or after `client.stop()`) rejects with `CLIENT_NOT_INITIALIZED` once `readyTimeout` passes; it returned `undefined`, which read as "no such item". Called while init runs, it waits for the database to open.
- **Breaking:** `Item.getById(id)` no longer takes a cache hold unless called with `{ hold: true }`, like `Item.find` and the definitions' `getById` (decision D29). Code that called `unload()` after a plain `getById` must drop that call; code that keeps the item across long work passes `{ hold: true }` and unloads it.
- A property assigned right after `Item.create(…, { waitForReady: false })` is kept and saved. In a process's first items, `Item` hadn't finished its deferred import of `Model`, so `create` built no ItemProperty instances; the assignment became a plain field on the item and was lost once the properties loaded (decision D16). `Item` now starts that import when it loads.
- `prepareHtmlEmbeddedImagesForPublish` and `rewriteHtmlEmbeddedImagesOnDisk` take `{ htmlArweaveRefs }`; with `'ar'` they write `ar://<id>` links into Html instead of gateway URLs.
- **Breaking:** `getArweaveUrlForTransaction` is `@seedprotocol/arweave`'s: `{first read gateway}/raw/{id}` (ADR 0025). The SDK's deprecated copy, which returned `BaseArweaveClient.getRawUrl(id)`, is removed.
- The SDK re-exports `rehostArweaveLinksInHtml`, `nextArweaveGatewayUrl`, `mapUrlAttribute`, `parseArweaveTransactionLink` and the `ArweaveTransactionLink` and `HtmlArweaveRefs` types from `@seedprotocol/arweave`.
- An Html property's value shows its Arweave links (`ar://<id>`, `/raw/<id>` on any host, `/<id>` on a known gateway) on this reader's first read gateway, so Html published with `ar.seedprotocol.io` links shows its images while that gateway is down (ADR 0025). The stored file keeps the links as written, and `exportArchive` skips the rewrite, so a bag keeps each Html exactly as published.
- Publish writes an Html value it uploads with every Arweave link on the public gateway (`arweaveDomain`, default `arweave.net`), in its path form. A link a reader re-hosted onto a Hyper sidecar or app proxy, and an editor saved back, was uploaded as that local URL.
- **Breaking:** validation errors carry named codes (`ItemCreateValidationError.problems[].code`, `ItemPropertySaveValidationError.validationErrors[].code`, the `validate()` results): `type` for a wrong type, `pattern`, `min_length`, `max_length_exceeded`, `enum_violation`, `format` for a Date that isn't one, `unknown_data_type`, and `required`, `unknown_field`, `minimum`, `maximum` in a property definition. Type and pattern failures carried TypeBox's numeric kinds as strings (`'41'`, `'53'`, `'62'`), and a `minLength` failure was reported as `max_length_exceeded` with a "characters or less" message.
- An enum miss is one problem, `enum_violation`, whose message lists the allowed values. It was two, with TypeBox's "Expected union value" messages, and every other problem on a property with an enum (a pattern miss, a List element of the wrong type) was coded `enum_violation` too.
- The 255-character `Text` error suggests `validation.maxLength` or an `Html` property instead of a `File` property; an explicit `maxLength` error no longer suggests anything.
- **Breaking:** `pattern`, `minLength` and `maxLength` on a property that isn't `Text` or `Html` (or a List of those) fail the property's validation, `rule_not_applicable` (decision D19). A schema file that sets them is rejected when it loads (`Schema <name>: <Model>.<property>: validation.maxLength only apply to Text and Html properties …`), before it is stored. They were silently ignored.
- **Breaking:** an unknown type name fails validation, `unknown_data_type`: in a schema file it rejects the load, and `schema.validate()` and `model.validate()` report it. `blob` is no longer read as a type name. Unknown names were capitalized and kept.
- `validation.custom` is ignored with a warning on every path (decision D5): a schema file that sets it loads and logs `[seed] schema <name>: <Model>.<property>: Custom validators are not supported …`, and the property's `validate()` reports it under `warnings` with `isValid` true. The structure check failed it, so renaming such a property in code wasn't written.
- The `Property` builders keep their own parameter types: `Property.Html({ htmlEmbeddedDataUriPolicy: 'preserve' })` type-checks, `Property.List()` needs its element type, and `Property.Relation`'s third argument is a boolean. `Property` was cast to `PropertyDefs`, which typed every builder as `(string?, string?, string | boolean?)`.
- The published `.d.ts` files resolve under `moduleResolution: node16` and `nodenext`: relative imports carry `.js` (or `/index.js`). Without the extensions, named re-exports of `@seedprotocol/sdk` and `@seedprotocol/sdk/node` were typed `any` and `export *` names such as `importJsonSchema` were missing (TS2305). drizzle-orm 0.44's own declarations still fail without `skipLibCheck`, so keep it on.
- `Item.create`'s parameter type takes property values beside the item fields, so `Item.create({ modelName: 'Post', title: 'Hello' })` type-checks as an object literal. The excess-property check rejected `title`.

### Commits

#### Breaking

- named validation codes; reject string rules on other types (8e806453)
- Item.create checks relation targets like an assignment (12ac3085)
- query, eas: queryBySchema attesters filter (e436bbcd)
- Item.find before init throws instead of returning undefined (ff563f08)
- Item.getById takes no hold unless asked (D29) (d8bc4654)
- arweave, query, feed: one getArweaveUrlForTransaction; feeds emit public Arweave links (1219b7ec)

#### Features

- warn when a removed request event is emitted (4276a0d4)
- save({ timeoutMs }) and a slow-save warning (D30) (e3134c6c)
- publish: htmlArweaveRefs: 'ar' publishes ar://<id> links in Html (936db56e)
- react: SeedHtml re-hosts Arweave links and fails over media loads (bcb63c5f)
- Html values show Arweave links on the reader's gateways; publish uploads them public (94d0b72b)
- arweave: rehostArweaveLinksInHtml moves Html's Arweave links onto the reader's gateways (2d64ac74)

#### Fixes

- export TabLockTimeoutError from ./node; OutboxOpFailedError carries RelationTargetError and StagedValueMissingError as cause (D31) (eda2cd64)
- type the Property builders with satisfies, not a PropertyDefs cast (a21c1cb5)
- Item.create's props type takes property values (d2399394)
- query: getSeed lowercases its uid, a seed with no Versions is not found, local reads skip the duplicate-module checks (527973ac)
- publish: createPublish defaults the data item signer; 'modular' wallet kind; useSeedWallet keeps kind (70fe3105)
- react: no '-<n>' schema-id fallback; create hooks report load errors (e1ad72b3)
- removeLocalCopiesForAddresses keeps owned copies with unpublished work (D24) (21b0d3ad)
- retry automatic EAS syncs merged into a failed client_api run (4e7ceea8)
- type pruneEntityChanges' db as drizzle's async SQLite database (babff420)
- Node live queries complete on close; Node prunes entity_changes (e9ed2a5c)
- sync records no conflicts for storage drafts (b8e23907)
- publish waits only for its own graph's outbox ops (fe32bb4c)
- storagePropertyName gives the stored name; stale entity JSDoc (0367b2c1)
- keep a property assigned right after Item.create without waiting (D16) (c6d88d5b)

#### Other

- Phase H text fixes (1bb65ae8)

## 0.7.11 (2026-10-24)

- **Breaking:** migration 0030 drops the `property_uids` table, and `propertyUids` is no longer exported. Nothing wrote to it; property EAS schema uids live in the schema uid store and on each metadata row's `schema_uid`.
- **Breaking:** `@seedprotocol/sdk/node` exports `NodeDb` and `NodeFileManager` in place of the deprecated `Db` and `FileManager` aliases, which are removed. Rename the imports; the classes are the same.
- A property saved after a publish registered its EAS schema stores that schema's uid on its metadata row, and `property.schemaUid` returns it. The row had none until it was published: publish recorded the uids it registered where `getEasSchemaUidForExactDefinition` didn't look, so the lookup asked the EAS indexer, which hadn't indexed the new schema yet. Saving a draft row again also fills in a uid it was stored without.
- `getEasSchemaUidForExactDefinition`, `getEasSchemaUidForSchemaDefinition` and `getSchemaUidForSchemaDefinitionFromCache` read one store, which `setSchemaUidForSchemaDefinition` writes, so a uid recorded there answers all three without a request. Its keys are exact definitions on the current EAS endpoint (`string title`); they were snake-cased and shared across endpoints. EAS sync and `@seedprotocol/query` record `<type> <name>` for each property attestation they read instead of the bare name.
- A local database that looks older than 0.7.7 is copied to `seed.before-recreate-<ms>.db` beside `seed.db` (in OPFS in the browser) before it is recreated, and the warning names the copy. A 0.7.7 database can look older: 0.7.7 wrote its `storedDisplayUrlsCleared` marker from a background task after init, so a database closed right after its first 0.7.7 start, or whose task failed, has no marker, and 0.7.8 to 0.7.10 recreated it, dropping its unpublished drafts. If the copy fails, or the database is a remote libsql URL with nowhere to copy it, the database is opened as it is instead of recreated.
- `@seedprotocol/sdk/node` exports `EntityUnloadedError`, `ItemCreateError` (and `ItemCreateErrorCode`), `PublishValidationFailedError`, `RelatedItemUnpublishedError`, `HtmlEmbeddedDataUriLimitError`, `HtmlSeedPropertyRefError`, and `exportArchive` with `ArchiveExportError`. A Node app importing from `./node` couldn't `instanceof` the error a write on an unloaded item throws. Both entries now export `OutboxOpFailedError` (`code: 'OUTBOX_OP_FAILED'`, the failing error's name in `errorName`), `RelationTargetError` and `StagedValueMissingError`; `save()` rejects with the first, and `ItemCreateError.cause` is usually one.
- `clear()` on an unloaded ItemProperty rejects with `EntityUnloadedError` before it writes. It appended the clear op first and then rejected from `save()`, so the caller got an error and the property was cleared anyway.

### Commits

#### Breaking

- drop the unused property_uids table (88635bf0)
- eas, arweave, publish: remove deprecated aliases (4d349091)

#### Fixes

- eas: one store for property schema uids, read by every resolver (0ea6562b)
- fail init the same way in tests as in production (f9343543)
- clear() on an unloaded property throws before it writes (652b7846)
- export the outbox, unload, archive and publish errors from ./node (bd62f748)
- back up a database before recreating it as older than 0.7.7 (55dd1a54)

#### Other

- fold resolveMetadataSchemaUid into lookupPropertySchemaUid (1725d65b)
- testing: a test default that differs from production needs a reason and a test on the real one (14ea224e)

## 0.7.10 (2026-10-24)

- New `exportArchive(item, { fetch, sourceOrganization, baggingDate })` writes a published item as a BagIt bag (docs/ARCHIVE.md): the Html with references to bagged files made relative (`data/index.html`), each Html exactly as published (`data/source/`), Images, Files and embedded images under `data/assets/`, every property's value, attestation uid and Arweave transaction in `data/item.json`, and Dublin Core and PREMIS metadata. It throws `ArchiveExportError` (`not_published`, `unpublished_changes`), and lists files it couldn't read or download in `omitted`. `@seedprotocol/sdk` now depends on the new `@seedprotocol/archive`.
- The browser client initialises without Iterator helpers (Chrome before 122, Firefox before 131, Safari before 18.4). `@zenfs/core` 2.5.6 called `Iterator.prototype.map` when it loaded, and init failed with `journalOperations.values(...).map is not a function`. `@zenfs/core` is now 2.7.7 and `@zenfs/dom` 1.2.14; an app that installs them beside the SDK needs the same versions.
- **Breaking:** `client.stop()` and `client.unload()` return a promise and release what the client holds: the outbox stops draining (pending ops stay in the database and resume after the next init), every cached Item, ItemProperty, Model, ModelProperty and Schema is stopped and dropped, this tab hands tab leadership to another tab, and the database is closed (in the browser, SQLocal's worker is destroyed). An instance kept across `stop()` is stopped; look it up again after `init`. `init` called while a stop is releasing waits for it. New `BaseDb.close()` (`IDb.close()`) closes the database on its own.
- `client.stop()` works after an init that failed or hasn't finished; it threw `CLIENT_NOT_INITIALIZED`. An init that runs again after a failed one closes the database the failed one left open, instead of starting a second SQLocal worker on the same file.
- New `checkBrowserSupport()` lists the browser features the SDK needs that the page lacks (`opfs`, `opfs-writable`, `web-locks`, `cross-origin-isolation`). In a browser missing any of the first three, `client.init` fails with `UnsupportedBrowserError` (`code === 'BROWSER_UNSUPPORTED'`) before it loads ZenFS. Supported browsers are Chrome and Edge 102, Firefox 114 and Safari 26 or later (docs/GETTING_STARTED.md).
- Creating a file in an OPFS directory that SQLocal's worker or another tab made after this tab mounted no longer fails with `ENOENT ... (Out of sync!)`. The mount now adds such directories and files to ZenFS's in-memory copy when it first finds them. ZenFS 2.5.6 ignored that error only when the stack trace was in Chromium's format, so Firefox and Safari could already hit it.
- A schema file's single Relation keeps its `refValueType` on the property row (e.g. `{ type: 'Relation', refValueType: 'Image', model: 'Image' }`). Only List properties kept it, so a schema-file Relation to an Image, File or Html wasn't treated as one; code-defined properties were unaffected. A `data:image/...` URI assigned to such a property failed with `Relation target not found`; it is now saved as an Image.
- A loaded item property takes its property's new definition when a schema change (`updateModelProperties`, a new schema file version) rewrites the property's row. It kept the definition it loaded with: in Node always, in the browser until the row's live query caught up, so a value assigned right after the change was written by the old definition's rules.
- **Breaking:** `Item.find`, `Item.all`, `ItemProperty.find` and `ItemProperty.all` no longer take a cache hold unless called with `hold: true`. Before, each call took one the caller had to release with `unload()`, and every caller that didn't (most app code) kept the instance loaded for good. An instance no one holds now stays cached for the grace period after its last release or lookup, then unloads (see `entityCache.unloadGraceMs` below). Code that keeps an item across long work holds it: `Item.find({ hold: true })` or `Item.retain(item)`, then `unload()`. Code that called `unload()` after a `find` without `hold: true` must drop that call, since it would release a hold someone else took. `Item.create` and `ItemProperty.create` still hold by default; `Item.create(props, { hold: false })` creates an item without one. `item.publish()` holds the item until the publish settles.
- **Breaking:** no lookup or create on `Schema`, `Model` or `ModelProperty` takes a cache hold unless called with `hold: true`: `create` (including when it returns a cached instance), `getById`, `Model.getByName`, `Model.getByNameAsync`, `createById`, `Model.createBySchemaId`, `find` and `all`. A definition stays cached whether or not anyone holds it (next entry), so a hold only counts the caller; `unload()` gives it back. Code that called `unload()` after one of these without `hold: true` can drop that call. When a call that took a hold throws (not ready within `readyTimeout`), it gives the hold back.
- **Breaking:** an Item's or ItemProperty's last `unload()` no longer stops it at once. It stays cached for `SeedConfig.entityCache.unloadGraceMs` (default 60000 ms) and a hold taken meanwhile keeps the same instance, without a reload. With 0, the last `unload()` stops it at once, as before, and an instance that never had a hold (created with `hold: false`, or only looked up) stays cached until it is evicted or the client stops. `destroy()`, cache clears, schema eviction, removals from other tabs and local purges unload at once whatever the setting. `client.stop()` and `client.unload()` unload every instance still waiting. Pending timers don't keep a Node process running.
- **Breaking:** a `Schema`, `Model` or `ModelProperty` stays cached until it is destroyed or evicted, or the client stops, whether or not anyone holds it: its last `unload()` no longer stops it, and there is no grace period. Evicting or destroying a schema or model still stops the models or properties only it held. Sync and name matching read the cached models synchronously (`Model.resolve`, `Model.findByModelType`), so with the grace period a model loaded without a hold unloaded after 60 s: sync then stored a seed's EAS name as its type (`htmlpage` instead of `html_page`), and a model name two schemas define could resolve to one of them instead of throwing `AmbiguousModelError`.
- `unload()` on an instance no one holds does nothing. It stopped the instance even when the caller had never held it.
- Assigning a property, `setValue`, `save`, `publish` or `unpublish` on an unloaded Item or ItemProperty instance throws `EntityUnloadedError` (exported), whose message names the item. So do assigning a property, `saveNewVersion`, `reload`, `model.create` and `modelProperty.save` on a destroyed or evicted Schema, Model or ModelProperty, naming it. Assignments did nothing and `publish()` never settled. Reads still return the last values.
- A property with a sync conflict never shows the synced value beside it. Sync recorded the conflict and moved the local draft back to newest in two writes, and a read between them (the change feed, a rehydrate) took the synced row as current; the two writes now share a transaction, and both readers read the row again when they find a conflict.
- `Item.retain(item)` takes a hold on a cached, running instance (false when it was stopped); so do `Schema.retain`, `Model.retain` and `ModelProperty.retain`. `Item.find` no longer keeps the hold it took when the item isn't ready within `readyTimeout`: it returned `undefined` and left the item held. When `Item.all` with `hold: true` throws (aborted by `signal`, or an item not ready within `readyTimeout` with `waitForReady`), it releases the holds it took; before, those items stayed held.

### Commits

#### Features

- unload grace period and no-hold lookups by default (504f56dc)
- state supported browsers, add checkBrowserSupport() (76447831)
- exportArchive writes a published item as a BagIt bag (a8f5563e)
- archive: add @seedprotocol/archive with BagIt bags, PREMIS, Dublin Core and an h-entry reader (9a88ae10)

#### Fixes

- a property never shows the synced value beside its sync conflict (da9afc01)
- writes on a destroyed or evicted Schema throw EntityUnloadedError (8287922c)
- definitions stay cached without holds; lookups take no hold (a2d3024d)
- load the validation module with await, not import().then (9b1a045a)
- evict entity caches on stop without importing the classes (fecfd304)
- client.stop() closes the database and drops cached entities (006b0240)
- react: useItems holds its items once per mounted hook (2a0a9492)
- load without Iterator helpers (ZenFS 2.7.7) (f88840eb)
- react: useItem holds its item once per mounted hook (8e9202d8)
- loaded item properties take a changed definition at once (c2004e04)
- keep refValueType for a schema file's single Relation (790a447a)

#### Other

- loadProperty comment names what reads a new property's definition (f7ff0798)

## 0.7.9 (2026-10-22)

- Browser init no longer fails with `DatabaseNotPersistentError` in Chromium builds that refuse workers started from a worker with an http(s) URL (seen in the Claude desktop app's browser pane). SQLite's OPFS VFS starts its async proxy that way from inside SQLocal's worker, so the VFS didn't install and SQLocal opened a memory database. The blob that starts SQLocal's worker now first installs a `Worker` replacement that starts nested http(s) workers from a blob: `import` for module workers, `importScripts` for classic ones, with later `importScripts` calls resolved against the original URL. This applies wherever SQLocal's worker URL is http(s), in dev and in builds; a bundler that inlines the worker as a `blob:` or `data:` URL skips it. Apps that installed their own nested-worker workaround can remove it.
- `DatabaseNotPersistentError` on a cross-origin isolated page says SQLite's OPFS VFS failed to install and points to SQLite's console lines, instead of telling you to set COOP/COEP headers that are already set. The constructor takes an optional second argument, `'headers'` (default) or `'vfs'`.
- **Breaking:** `status` on `Model`, `Schema` and `ItemProperty` is the load status, `'loading'`, `'ready'` or `'error'`, not the actor's state value. An ItemProperty that was `'idle'` once loaded is `'ready'` (PermaPress `TipTap.tsx` compares `status === 'idle'`). `Item` gains `status`, and every entity has `waitForReady({ timeout })`. The state value is still `getService().getSnapshot().value`, and the entity machines no longer have `loading`, `waitingForDb` or `error` states: an actor is `idle` from the start, so waiting for `idle` no longer means loaded. Ready means loaded: an ItemProperty with a pending save is ready.
- **Breaking:** removed `waitForEntityIdle` (use `entity.waitForReady()`), `Model.updateNameIndex`, the internal `Model.takeSchemaHold` / `dropSchemaHold` / `releaseSchemaHolds` and `ModelProperty.adoptForModel`.
- New exports `isClientReady()` (client init finished and the app database open), `isClientReadySnapshot(snapshot)` (moved from `@seedprotocol/react`, which re-exports it) and `whenDbReady(timeoutMs)`. `BaseDb.isAppDbReady()` is unchanged.
- The five entity classes share one cache, teardown and load status (audit T1). Each class has one `EntityCache` (`Model.cache`, `Schema.cache`, ...): one entry per instance under all its keys, its id first. Fixes that come with it:
  - A renamed Schema is cached under its new name only: `Schema.create(newName)` returns it, and `Schema.create(oldName)` no longer does. Before, the new name loaded a second instance for the same row.
  - A Schema created again after an unload, evict or `clearCache` is found by its file id (`Schema.peek(id)`, `Schema.find({ schemaFileId })`). Before, only the first instance per id per process got the id key.
  - `Schema.clearCache()` stops every cached schema. A schema held more than once kept running after it.
  - `Model.destroy()` stops its cached ModelProperty instances, held or not; `ModelProperty.getById` returned a destroyed model's properties.
  - `ModelProperty.destroy()` deletes the property's row by its file id. It looked the row up by schema, model and property name, and deleted nothing when the schema name hadn't resolved.
  - Loading an Item looks each property up once: the load and the change feed reuse the instances the item already has. Before, an Item load looked each property up three times, with a metadata read each.
  - An Item's seed uid key follows its context (publish, republish), so lookups by uid no longer scan every cached item.
  - A ModelProperty update with only internal keys is applied; one sent outside a save was dropped. A Model update with only internal keys keeps its validation errors.
- A Schema's live query watches its own row id; it looked the row up by name. The Model and Schema live queries no longer retry their row lookup on a timer for up to a minute: an entity looks its row up again when its load or its row write changes it. The Model and Schema draft saves skip during client init by `isClientReady()`, not a 50 ms cached check.

- **Breaking:** `watchEntityRows` lost its `since` option (no caller), and `window.__SEED_INVALIDATE_ITEM_PROPERTIES__` is no longer declared, set or called (`@seedprotocol/react` set it; nothing else read it).
- In the browser, loaded items learn about sync's writes from the change feed only (ADR 0020, audit T3). A loaded Item also watches its seed's `metadata` rows, so a property row sync writes on a version the item already has adds that property to the item. `syncDbWithEas` no longer re-reads every cached item's metadata and rehydrates its idle properties after each sync, in this tab and in every other tab that hears the sync event; Node still does after every sync, having no feed (decision D3). The sync event is still emitted and relayed to other tabs.
- A loaded property shows a conflict that sync recorded over its draft (`property.conflict`) once the change feed reports the write, in the browser; the change-feed read now includes the recorded conflict. Before, it appeared only after the post-sync rehydrate or a reload. A property with a pending edit shows none, since the edit settles it.
- **Breaking:** removed `Model.trackPendingWrite` and `Model.getPendingModelIds` (nothing read the map they kept) and `ClientManagerState.ADD_MODELS_TO_STORE` (the init step did nothing). `schema.status` is `'loading'` while a schema loads, not `{ loading: <stage> }`, and a schema no longer passes through `'validating'`.
- Model and ModelProperty write their definition rows with one awaited call instead of a spawned write machine. An edit sent to a new model or property before its write started could drop the write, leaving `Model.create`/`ModelProperty.create` to wait out its timeout; it can't now. `Model.create` with `properties` creates the property instances as part of the same awaited write, and the model no longer enters a `creatingProperties` state.
- A Schema loads in one step that reads its row (applying a version file of that name first when there is no row) or creates it. An edit sent while it loads no longer abandons the load. `Schema.validate()` validates the loaded schema and returns at once.
- Client init steps are awaited functions; init no longer sleeps 10 ms or waits up to 1 s before starting.
- `Model.all` of a schema with no models returns at once; it retried for 600 ms. Writing a schema file, opening the browser database and reading a new property's row no longer poll after their own awaited writes.
- Reading the stored addresses before init opens the database waits up to 30 s for it, then returns none. It re-polled every 500 ms forever.
- An assignment's outbox op is appended before the setter returns (decision D2, ADR 0019). The ownership check, a Relation's target check and the EAS schema uid lookup run when the drainer prepares the op, as does a storage value's file write: an Html, File or Image string (a URL, a file name, the text) travels in the op, and a Blob's or `data:` URL's bytes go to a staged file the op names in `pending_writes.value_ref`, written by the assigning tab right after the append. An op whose staged bytes never landed (the tab closed first, or the write failed) fails with `StagedValueMissingError`; an ItemStorage op whose staged file is missing is staged again from the text it carries. A pending Html value shows its text after a reload, as before.
- The change-feed read of a loaded property no longer skips rows while a write of that property is in flight. A read begun before an assignment in the same tab is dropped instead, and a row that shows the value the property already has keeps its display (a session URL, Html text).
- In the outbox a run of value ops for one property waits for its newest op only, so an older op set aside (its staged bytes still being written) no longer holds up the newer one that supersedes it.
- Publish reads rows, not loaded items (audit T11). `getPublishGraph` (new export) walks a publish's seeds once: each seed's model definitions and each property's current row, read after pending edits are written. `getPublishPayload`, `getPublishUploadData`, `itemHasPublishUploadCandidates`, `summarizePublishWork`, `getUnpublishedRelatedItems` and the Html-embedded image passes read that graph and load no Item, so a publish leaves no item cached and running. Changes:
  - A property attests the value of its newest row, also when the loaded instance shows an older one (an edit from another tab, or one the instance missed). Publish no longer repoints such an instance.
  - Each request carries `versionLocalId` (the version row it was built from) and each attestation `_metadataLocalId` (the row its value came from). `updateVersionUid` and `applyPropertyAttestationUidsFromPublish` record exactly those rows; a row saved while the publish ran stays a pending draft. The storage transaction attestation of an upload also records the transaction id on the seed's `storageTransactionId` row (`_attestedValue`), creating the row when the seed has none.
  - A Relation to an Image, File or Html holding a saved file is uploaded once. It was also uploaded a second time through the related item, an upload nothing attested.
  - `summarizePublishWork` counts what the payload attests: ItemStorage files found through their rows (it read only the loaded instance's path), the storage seeds of Image, File and Html properties as new seeds with their own requests (it counted only their bytes), and each upload's storage transaction attestation.
  - A storage-seed file is uploaded only when the publish attests its seed. A published storage seed's file was uploaded again on every publish of an item referring to it.
  - `prepareHtmlEmbeddedImagesForPublish` reuses the Image item an earlier attempt made for the same Html and data URI while it is still a draft with its file. Each retry of a failed publish created new Image items and files.
  - Every reader of the graph waits for pending edits to be written first, as `getPublishPayload` did. `getPublishUploadData`, `summarizePublishWork`, `getUnpublishedRelatedItems` and `itemHasPublishUploadCandidates` read loaded instances without waiting.
  - `rewriteHtmlEmbeddedImagesOnDisk` rewrites the Html files only; a loaded Html property shows the rewritten Html after a reload.

- One reader decides which row holds a property's value (`currentPropertyRow`, internal): the newest of the property's rows by `property_id` (rows without one by name), with the property's newest pending outbox value over it (ADR 0019). ItemProperty's load, rehydrate, change-feed read and Node read, `ItemProperty.find`, `getItemProperties`, `getPublishPendingDiff`, `loadOrCreateItem` and publish's storage-seed fallbacks use it. Changes: the change-feed read shows another tab's assigned value before its op applies; `getPublishPendingDiff` reports a pending value as `currentValue`; a row with a file reference no longer wins over a newer row of the same property stored under another name; loading an Image whose row holds the image seed's uid no longer writes the derived file reference back to the row.
- Image, File and Html saves run one pipeline (`storageValue/save.ts`). A File or Html property's first row stores the property's own EAS schema uid; before, it stored the File or Html model's uid. Strings assigned to an Image that used to fail with "No file data found" or fetch relative to the page now save: `data:` URLs of any image type or with parameters (`data:image/svg+xml;base64,...`, `data:image/png;name=a.png;base64,...`), raw base64 whose bytes have an image signature, and `host.tld/path` (fetched over https). A new file without a source name takes its MIME type's extension (`.svg`, not `.svg+xml`), File values from a `data:` URL included. Image and Html saves wait for the file system as File saves did.
- Html saves no longer store a session URL in `metadata.ref_resolved_display_value`, and Html reads ignore one stored by an earlier SDK. An Html property's `refResolvedDisplayValue` is undefined; its value is the file's text, as before.
- Pending `storage` ops carry one `row` record in place of `create.values` and `update`. Ops an older SDK appended still apply.
- Publish reads a storage seed's file from the property's `localStorageDir` when it has one, and an ItemStorage child's row is its current row, not the newest row of the property's context version.
- Removed the exported type `GetPropertyDataOptions` (its reader, `getPropertyData`, was internal).
- Migration 0029 adds unique keys: one `model_schemas` link per model and schema, and one `seeds` and one `versions` row per attested uid (partial indexes; drafts' placeholder uids such as NULL and the zero `bytes32` are left out). Existing duplicates are merged first: the survivor is the row with local children (versions for a seed, property rows for a version), then the oldest; the duplicate's versions, property rows, pending writes, publish processes and finalize jobs move to it, columns it lacks are copied, and a property row the survivor already has under the same attestation uid is dropped. Writing a second row under an attested uid now fails with a UNIQUE constraint error.
- EAS sync no longer inserts a second seed or version row for a uid that publish recorded while the sync ran, and publish recording (`updateSeedUid`, `updateVersionUid`) merges a row a sync inserted for the same uid into the publishing item's row, in one transaction.
- Schema, model, property and `model_schemas` rows are written by one module (`db/write/definitions.ts`, internal), each user action in one transaction: a schema file apply, a property save, a runtime model write, a model or schema rename, `saveNewVersion`'s flag clears, and `Model.destroy` / `Schema.destroy` row deletes.
- A ModelProperty save without `required` keeps the row's value. `savePropertyToDb` set it to false, so editing any field of a required Relation or Image made it optional. Data type, storage settings and `is_edited` follow the same rule: left out, the row keeps its value; a new row gets the default.
- `Model.lastSaveError` reports a failed rename save. The Model rename save caught every error, so it was always undefined.
- A second rename of a Model or Schema while the first is being saved is saved after it. It was skipped, leaving the earlier name in the row.
- A property id found on another model's row is no longer moved to the model being written (`writePropertyToDb` did; the other writers already left it).
- On Node the SDK registers `NodeEasClient` from `@seedprotocol/eas/node` instead of `DefaultEasClient`, so EAS reads on Node 24.21+ skip the slow post-quantum TLS handshake to easscan (about 1.45 s per new connection) and reuse connections for 30 s. To use fetch's defaults instead, call `EasClient.configure(new NodeEasClient({ dispatcher: false }))` after `client.init` (`NodeEasClient` from `@seedprotocol/eas/node`).

- An item synced without a `model_file_id` gets its model from its type by easName at the model's nameMatch level (`blog_post` → "Blog Post", `html_page` → "HTMLPage"), in `getItemData`, `getItem`, `Item.create`, ItemProperty and `loadOrCreateProperty`. Before, `startCase(type)` gave "Html Page" and `upperFirst(camelCase(type))` gave "NewModel" for "New model", so such items lost their property definitions. When models in several schemas match the type, `Item.create` throws `AmbiguousModelError` instead of taking the newest row. The mapping is `modelNameForType` in `db/read/resolveModelRecord` (internal).
- Seed rows are found by one rule everywhere (`findSeedRow`): the local id first, then the uid through `versions.seed_uid` (a republished seed's old uid), then `seeds.uid`. `getItemData`, `Item.find`/`Item.create` loading, the item watch, `getAttesterForSeed`, `getSeedPublishState`, ownership checks, relation refs and property saves each had their own order; some took the uid over the local id, others matched any row with either.
- `Model.find({ modelName, schemaName })` and `Model.getByNameAsync(name, schemaName)` read the database when the model isn't cached. They returned undefined.
- `model_uids` is written by one rule at init and in sync: only the model's own EAS schema (`bytes32 <easName>`), for every model row with that name, replacing a uid stored earlier. Sync used to record a schema under an older SDK's name (`bytes32 htmlpage`) when there was no `bytes32 html_page`, and new seeds then used it. Init and `getEasSchemaUidForModel` now ask EAS for every name the model can match at its nameMatch level, as sync does. Seeds under older names are still synced.
- Looking up a property's EAS schema uid by definition (item property init, publish) asks for that exact definition. Before, a cache miss fell back to a schema whose definition ended with the snake-cased definition.
- New `Schema.find({ schemaName })` returns the cached or stored schema with that name, or undefined, and never creates one. SDK code that only reads a schema uses it, so validating or saving a property with an unknown `_schemaName` no longer inserts a draft schema row. `Schema.find` also takes `hold: false`.
- `renameModelInDb`, `savePropertyToDb` and ModelProperty's write path resolve models through `resolveModelRecord`. A rename or property write scoped to a schema that lacks the model no longer falls back to a same-named model of another schema.
- `getEasSchemaUidForExactDefinition` is exported.
- `property.clear()` removes a property's value, and `property.clear({ retract: true })` retracts it (ADR 0021). Both show the property empty at once, write a cleared row through the outbox, and resolve when it is stored; a refused or failed clear restores the value. Publish then attests the EAS type's empty value for a removal (`''` for Text and Number, a zero `bytes32` for Image, File, Html, Json and Relation, `[]` for List), in `patch` and `new_version` mode, or revokes the property's attestations for a retraction (see `@seedprotocol/publish`). Boolean and Date have no empty value: `clear()` rejects with `ClearNotSupportedError` unless it retracts, and a published Boolean or Date with an empty draft fails publish validation with `publish_clear_unsupported`. Migration 0025 adds `metadata.retract`.
- `setValue(null)` and `setValue('')` on an Image, File or Html property (or a Relation to Image) clear it. Before, `''` passed `saveImage`'s existing-file check (`getFilesPath('images', '')` is the images folder) and saved an image seed pointing at no file, File did the same with the files folder, and `null` failed and kept `null` on screen while the stored row held the old image.
- A failed Image, File, Html or ItemStorage save restores the value shown before it, as a refused save already did. Before, the failed value stayed on screen.
- `getPublishPendingDiff` entries have a `change` (`'set'`, `'removed'` or `'retracted'`), and an empty value with nothing on chain to remove (never attested, or already retracted) is no longer listed. `summarizePublishWork` counts removals in `attestationCount` and adds `revocationCount`.
- New exports `getPendingRetractions` (a seed's retracted properties and the attestations publish revokes for each: the live ones on the Version of the newest, and those on other Versions with one of their values) and `markPropertyAttestationsRetracted`.
- Local reads of a cleared Image no longer fall back to the image it replaced: `getPropertyData` and `resolveMetadataRecord` count only each property name's newest row, and an item reload no longer prefers an older non-empty row over a newer empty one.
- The bulk file download after each EAS sync skips transactions whose file is already on disk (a non-empty `<txId>` or `<txId>.<ext>` under `images/`, `html/`, `json/` or `files/`, or, for a composite with known child paths, every routed child). Before, every run fetched every known file from the gateway again, rewrote it in OPFS and announced it as changed in every tab. Lazy downloads of one file (`ensureImageLocal`, hydration) still always download.
- The bulk download no longer writes `metadata.content_hash` (nothing read it) and no longer runs a bulk 480 px resize afterward, which never resized anything. Image saves and `ensureImageLocal` still create the size variants.
- The image resize worker recognises a WebP file with no MIME type. It compared the fourth byte with `R` instead of `F` (`RIFF`), so such files went to `createImageBitmap` labelled `image/jpeg`.
- Renaming a property through its setter (`modelProperty.name = 'heading'`) no longer hides item values under the old name. Readers now find a property's metadata rows by `property_id`, so after a reload `item.heading` returns the value and `item.title` is undefined. A rename changes only the properties row; the rows keep the name they were stored under.
- Every metadata writer sets `property_id`: `Item.create` (List-of-Relation rows had none), edits of a published value, the outbox appliers, EAS sync and publish recording. Migration 0027 links existing rows whose seed records its model (`seeds.model_file_id`); rows it can't match to exactly one property keep NULL and are still read by name. The startup scan that tried to fill `property_id` on every init (`backfillMetadataPropertyIds`) is removed.
- New metadata rows are stored under the property's storage name: `<singular key><Ref>Ids` for a List of Relation (sync stored these under the key), `<key>Id` for an Image, File, Html or Relation (`Item.create` stored a first Relation row under the key), else the key.
- A local draft and the row sync writes for the same property now pair by `property_id` when sync keeps the draft (ADR 0019), so a draft of a List of Relation or of a first Relation row records its conflict. Publish recording finds a Relation row stored as `<key>Id`.
- An unchanged schema is no longer re-applied on every init. The schema row now records the applied file's content hash (migration 0026, `schemas.content_hash`), and a `config.schema`, version file or internal schema whose id, version and hash match is skipped: no schema, model or property writes. The first init after upgrading applies each schema once more to record its hash.
- A schema file's rows (schema, models, properties, links) are written in one transaction.
- Every schema file is read the same way, whichever entry point loads it (`config.schema`, `importJsonSchema`, `syncSchemaFromSource`, `Schema.create`, the property updates): `type` or `dataType`, a Relation's target from `model`, `ref` or `refModelName`, and storage as a `storage` object or as `storageType`/`localStorageDir`/`filenameSuffix`. Before, some paths dropped a Relation's target when the file used `ref` (PermaPress's shape) and `updateModelProperties` stored every `dataType`-keyed property as Text. A property's `htmlEmbeddedDataUriPolicy` now reaches its Model property too.
- `Schema.saveNewVersion()` writes the next version file from the previous one, with the instances' models merged in by id. Model `description` and `indexes`, and property `validation`, `htmlEmbeddedDataUriPolicy` and other fields the instances don't carry, used to be dropped from the new file when the schema had been loaded from the database.
- A failed schema load (unreadable file, database error) leaves the `Schema` in its `error` state with `_loadingError` set. Before, it fell through to creating the schema, which could overwrite the existing row's data, id or draft flag.
- The SDK registers the clients from `@seedprotocol/arweave` and `@seedprotocol/eas` (`DefaultArweaveClient`, `DefaultEasClient`, `DefaultQueryClient`) on both platforms instead of its own copies. Behaviour that changes:
  - On Node, `BaseArweaveClient.getTransactionData` tries the preferred read gateways (`setPreferredArweaveReadBaseUrls`, `config.gateway`) before the configured host, as the browser already did.
  - In the browser, EAS query results are keyed by EAS endpoint, so a page that switches chains never reuses another chain's result; a settled result is kept only for the caller's `staleTime` instead of 5 minutes; and `networkMode: 'onlineOnly'` reaches TanStack Query as `'online'` (it was passed through unmapped and acted like `'always'`).
- Revoking a seed no longer sends version or metadata uids stored as `'NULL'`, blank, or a zero uid in upper case or with spaces. `getVersionsForSeedUid`, `getMetadataAttestationUidsForSeedUid` and publish's draft check now use `isPlaceholderUid` from `@seedprotocol/eas`.
- The download and resize workers use the SDK's MIME sniffer. An untyped file is labelled `image/heic` for every HEIF brand (it was `image/jpeg` for all but `heic`), and a download starting with `BM` goes to `images/` only when it is longer than a BMP header. ICO files are sniffed as `image/x-icon` on upload too.
- `resolveMediaRef` documents that a `localBlob` href is a new blob: URL per call, which the caller revokes; `useResolvedMediaRef` does.
- A property's whole definition is stored on its row (migration 0028, `properties.definition`): `validation`, `htmlEmbeddedDataUriPolicy`, `description` and any other field of the schema file's property, or of a code-defined one. The migration fills it from the stored schema files, matching each row's `schema_file_id` to a property `id`. Every definition lookup reads it (`getPropertyDefinition` in `helpers/propertyDefinition`, internal), so:
  - A schema file's `htmlEmbeddedDataUriPolicy: 'preserve'` reaches publish. Before, only a policy set in code did, and a file's `preserve` was materialized anyway.
  - Validation rules set in code (`Model.create`, `ModelProperty.create`) are stored when the property is created, and still apply after a reload. Before, they lived on the instance until the next `saveNewVersion`.
  - A property loaded from the database (`ModelProperty.createById`, an item's properties after a reload) has its validation and data URI policy.

### Breaking

- **A failed write shows the property's current value; an invalid value stays with its errors (decision D2).** When a write is refused (`OwnershipError`) or fails, the property shows the overlay's next value: a newer pending value of the property from any tab, else its stored row. Before, it restored a snapshot taken at assignment, and a failed File or Image save kept the new value. A value that breaks a rule (length, pattern, enum) now stays shown with its errors on `saveValidationErrors` and is not written; before, it was rolled back. `save()` rejects as before. A non-owned item's assignment appends an op that the drainer fails, where it used to append nothing.
- `setValue(value, { before })`: the `before` option is removed, and `showValue` no longer records a value to roll back to. Removed exported types `PropertyValueSnapshot` and `SaveValueToDbEvent`, and `PropertyMachineContext._valueBeforeSave`. The property machine no longer has a `saving` state or `save`, `saveFailed` and `saveValueValidationError` events; `context.isSaving` is true while the latest assignment's op is pending. PermaPress's `setAndSave` (`packages/app/src/helpers/propertySave.ts`) passes `before`; it compiles against its own `SavableProperty` type and the option is now ignored. After an `ItemPropertySaveValidationError` the field keeps the invalid value, and after an `OwnershipError` it shows the stored value, so its "Nothing was saved" messages still hold.
- `getPublishUploadData(item, options)` and `getPublishUploads(item, options)` take the options second; the `uploads` and `relatedItemProperty` parameters are gone. Both accept any `{ seedLocalId }`.
- `applyPropertyAttestationUidsFromPublish` records a pair on the row named by `metadataLocalId` only. A pair without one no longer updates the newest placeholder row of a property with that name; with `propertyName` and `value` it records a new row.
- Removed exports: `getSegmentedItemProperties`, `getRelatedItemsForPublish`, `getPublishDraftGraph` and its types (`PublishDraftGraph`, `PublishDraftGraphNode`, `GetPublishDraftGraphOptions`), `shouldAttestProperty`, and the types `GetItem` and `GetItemParams`. Use `getPublishGraph`. PermaPress uses none of them.

- **Schema ids an import assigns now come from the names (heads-up for PermaPress).** A schema, model or property without an `id` gets one derived from the schema, model and property names (first 10 hex characters of SHA3-256 of `schema/model/property`), and the id is written into the stored version file. Before, it was a hash of the whole schema's content, so adding one property changed every id. A database that already has the schema keeps the ids it stored, matched by name; a fresh database gets the new derived ids, which differ from the content-hash ids 0.7.x gave it. Ids pinned in the schema file (PermaPress's `seedSchema.json`) are used as they are and don't change. Pinned ids are still needed for renames: a renamed model or property without one is a new one.
- **A schema rename writes the next version file.** Setting `schema.name` on a published schema writes `<id>_<new name>_v<n+1>.json` and applies it. Before, only the row was renamed, and the next init renamed it back from the old files. A draft schema (no file yet) is still renamed in its row only.
- **`loadAllSchemasFromDb()` reads only.** It returns one entry per schema row, each resolved from the row (a draft's `schema_data`, else the row's id-and-version file, else `schema_data`, with the linked models merged in). It no longer imports schema files that have no row, rewrites rows from newer files, or returns entries with `source: 'file'`; init applies those files. `LoadedSchema.dbMatchesFile` is removed. `Schema.all()`, `useSchemas` and the item definition fallbacks no longer write `schemas` rows.
- `importJsonSchema(input, version)` uses `version` only when the JSON has none; it used to replace the file's own version. A complete file imported by path keeps its ids and version (it was read as the minimal format before). A changed minimal `{ name, models }` import is stored as the next version.
- `loadSchemaFromFile(path)` also stores the file in the working directory under its `<id>_<name>_v<n>.json` name.
- Minimal `<name>-v<n>.json` files in the working directory are no longer imported at init. Import them with `importJsonSchema` or pass them as `config.schema`.
- Removed export `getRefValueType` (`@seedprotocol/sdk/node`). Schema files are read by `normalizePropertyRecordSchema`, which takes a List's element type from `refValueType` or `items.type`.
- `getPublishPendingDiff` groups rows by `property_id` and reports each property under its storage name (`authorId`, `authorIdentityIds`), not the stored name of its latest row. Rows without `property_id` are reported as before. PermaPress compares these names with its own lists (`publishPendingPropertyValuesDiffer`); a Relation whose rows were stored under the key now reports `<key>Id`.
- `pickLatestMetadataRowPerProperty` groups rows by `propertyId` when the rows carry it, else by `propertyName`.
- `getPropertySchema(modelName, propertyName, scope)` returns the property's row definition (with `validation`, `htmlEmbeddedDataUriPolicy` and `description`), or undefined when the model or property has no row. It no longer reads the loaded Schema's file definition first, no longer returns a definition for a property that only exists in memory, and no longer guesses that an unmatched row with the same data type is a renamed property. A bare model name two schemas define throws `AmbiguousModelError`; pass `schemaName` or `modelFileId`.
- **Publish fails for a property with no definition.** When an item property has no definition in memory and its model has no properties row for it, `getPublishPayload` throws. Before, publish set the property's definition to `{ dataType: 'Text' }` and could attest it as `string <name>`.
- **Clearing a published Text or Number publishes the removal.** A property set to `''` or `null` after it was attested now attests `''` on the next Publish. Before, publish skipped the empty value and the old one stayed on chain.
- **A property attestation revoked while its seed is live reads as empty.** EAS sync stores it with no value, and local reads take each property's newest row whether or not it is revoked, so an earlier Version's value no longer shows through. A revoked seed keeps its last values as before. Removals synced from EAS (`''`, a zero `bytes32`) are stored with no value too, and a zero `bytes32` is no longer fetched as a related seed.
- **A local database written by an SDK older than 0.7.7 is recreated.** On the first start with this version, `prepareDb` drops every table of such a database before migrations run (browser and Node), and logs a `console.warn` saying so. Items that were never published are gone; published items come back with the next EAS sync. A database 0.7.7 or later opened is kept as it is. Files under `filesDir` are not deleted. The SDK tells the two apart by the last applied migration (0020 or later means 0.7.8+ opened it) and, for databases on migration 0019, by the `storedDisplayUrlsCleared` appState key that 0.7.7's first start wrote.
- The repairs for data written by 0.7.1–0.7.6 are removed, since no such database is opened any more: the legacy ItemStorage row migration (and publish's lazy conversion of those rows), the ambiguous-legacy-item reset, the foreign-attestation cleanup, the row-publisher alignment, the stored display URL clearing, and sync's fixes for doubled quotes in `seeds.attestation_raw` and for foreign version and property rows.
- Removed exports: `restoreDataItemIdsOverwrittenByL1` and `applyArweaveL1TransactionIdLocal`.
- Removed exports `getEasSchemaForItemProperty` and `getEasSchemaUidBySchemaName`. They matched property schemas by name, which matches schemas of any type. Use `getEasSchemaUidForExactDefinition` with the full definition (`string title`). PermaPress uses neither.
- Removed public APIs that had no users. PermaPress uses none of them, so it needs no change.
  - The Markdown import (`@seedprotocol/sdk/node`): `parseMarkdownFrontmatter`, `processSeedConfig`, `saveModelsFromMarkdown`. The SDK no longer depends on `js-yaml`. To define models in a file, write a schema file and pass it to `importJsonSchema` or `config.schema`.
  - The CLI and webpack helpers on `@seedprotocol/sdk/node`: `PathResolver`, `BasePathResolver`, `commandExists`, `ensureNodeDbSchema`, `runSeedInit`, `findSeedBinary`, `INIT_SCRIPT_SUCCESS_MESSAGE`, `SCHEMA_TS` and `withSeed`. Use `withSeed` from `@seedprotocol/next` for Next.js. `PlatformServices` (`@seedprotocol/sdk/platform`) no longer has `pathResolver`. On Node, `.seed` is still `<process.cwd()>/.seed`.
  - The schema file API: `createSchema`, `readSchema`, `deleteModelFromSchema` and `deletePropertyFromModel`. Files written by `createSchema` were never loaded; change schemas through `Schema`, `Model` and `ModelProperty`.
  - `requestEasSyncFromEventBus` and the `EasSyncRequestSource` type. Nothing emitted the `syncDbWithEas` event it listened for; call `client.syncFromEas()` instead.
  - Unused types: `SeedInitBrowserProps`, `SeedInitBrowser`, `DbQueryResult`, `ResultObject`, `SqliteWasmResult`, `SqliteWasmCallback`, `ReturnObj`, `PublishRequestData`, `PropertyToUpdateWithSeed`, `GlobalMachineContext`, `PublishMachineContext`, `GetSchemaForModelEvent`, `HydrateExistingItemEvent`, `WebpackConfigContext`, `Environment` and `ClientCallback`.

### Commits

#### Breaking

- feed: drop FEED_EXPAND_RELATIONS, always expand relations (583dc993)
- query, feed: remove deprecated aliases (dfe0c27e)
- use the tier-1 packages' clients and helpers instead of copies (00746953)
- remove dead public types (0aaf33c7)
- remove requestEasSyncFromEventBus and the 'event_bus' sync source (e6fdaad2)
- remove the schema file CRUD API (9d25f81c)
- remove the node entry's CLI and webpack exports (4369d49e)
- remove the Markdown import (f17d9b90)
- recreate databases older than 0.7.7, drop the legacy repairs (8bebbd1c)

#### Features

- write and read properties.definition (4769e193)
- db: migration 0029 merges duplicate chain uids and adds unique keys (3885655e)
- add properties.definition column (migration 0028) (453e216a)
- Schema.find({ schemaName }), a lookup that creates nothing (3820b4e7)
- arweave: DefaultArweaveClient with the preferred-gateway read loop (560cdf0d)
- schemas.content_hash column for the applied schema file (bae9213b)

#### Fixes

- ItemProperty.find reuses an instance made while it read the row (839daa3d)
- a sync-time conflict reaches a loaded property through the change feed (a77eadbf)
- ItemProperty.find checks the cache under both ids (126e2226)
- resolve the internal schema from its row, not a file (0342e628)
- loadOrCreateModel waits for a loading Schema's string state (55a70bfc)
- keep a pending ItemStorage value shown until its file lands (54e7db63)
- publish time no longer waits on the metadata reads (82a33163)
- query, feed: monthly archives use UTC month bounds (7fce0a25)
- Node's first metadata read skips when the context changed meanwhile (d98bc0b4)
- sync and publish recording write chain uids through the unique indexes (318758ad)
- Node's first metadata read keeps a pending or newer value (21feb669)
- eas: fetch only Version attestations as a seed's versions (a631a084)
- drop unused seeds import and appDb in syncDbWithEas (285c93f0)
- local query source labels seeds with their EAS schema name (f4c2a2bf)
- loaded Items take publish times from their seed and version rows (a88cfa11)
- publish: write public gateway URLs into published Html (f83bffd9)
- publish: record a publish uid on the row whose value was attested (6c43bdb4)
- reopen the database when another tab holds seed.db (b1fcb43f)
- keep an ItemStorage value shown while its row points at the file (0cbdd8c3)
- start SQLite's OPFS proxy from a blob inside SQLocal's worker (1b5f6898)

#### Other

- Item and ItemProperty on the shared entity lifecycle (9f7cf4e5)
- Schema on the shared entity lifecycle (1aca3008)
- Model and ModelProperty on the shared entity lifecycle (ba8ae7ba)
- shared entity cache, lifecycle and client readiness (428c2c2d)
- react: one item-properties refetch per property save (a082952a)
- drop the change feed's liveQuery-era API (9e2dfedb)
- loaded items watch their seed's metadata; the browser drops the post-sync rehydrate (d6cf0755)
- getPublishGraph waits for the outbox, so every publish reader sees pending edits (685d6675)
- build publish from rows with one graph walk (T11) (9e67b723)
- drop empty-result retries and polls after awaited writes (T2) (1996f3a6)
- the value setter appends its outbox op; rollback is the overlay (D2) (6495f5b1)
- client init steps are awaited functions (T2) (36c928a7)
- Schema load is one awaited function; validation is an assign (T2) (e3b477d1)
- definition writes are one awaited saveDefinition (T2) (9fa7eaef)
- one current-row reader and one storage-value pipeline (T5) (5549a4d5)
- one definitions module writes schema, model, property and link rows (4a86acb2)
- register NodeEasClient on the Node platform (ba3eb791)
- load item and schema definitions from property rows (53622320)
- read property definitions from their rows (3600450a)
- Group rows without property_id with a same-named row that has one (76fe6b69)
- eas: one EAS model-schema lookup and one model_uids rule (02e732aa)
- Match metadata rows to their property by property_id (39c5191d)
- one path from schema file to rows (applySchemaFile) (d4d05a37)
- Clear a property: clear() and clear({ retract: true }) (ADR 0021) (fdd7e375)
- map model types to models through modelNameForType (6a99d2cb)
- inject the shared MIME sniffer and data-URL helpers into the workers (8820c557)
- one model and seed-row resolver for every lookup (f8768d04)
- ADR 0021: clearing a property; add metadata.retract (migration 0024) (90223275). The migration shipped as 0025.
- Refuse empty Image/File/Html values; restore the shown value on storage save errors (c59ee6f9). Replaced before 0.7.9 shipped: an empty value clears the property.
- Stop model loads from rewriting property rows and clearing is_edited (87eea50a)
- Run the head-version regression test in the browser project too (d5030018)
- Release the Item holds publish reads take on related items (097d8461)
- Fix WebP sniff in the image resize worker (817ef090)
- Pick the head version with one order in every reader (b69a9fe2)
- Skip files already on disk in the bulk download; drop content_hash write and bulk resize (6ec6c496)
- Match synced seeds through versions so a republish's old uid is not a second seed (4a7fdf3c)
- Apply internal-only Schema updateContext events so draft saves keep _dbUpdatedAt (4ea04d06)

## 0.7.8 (2026-10-20)

- Item edits go through an outbox (ADR 0019). Setters, `save`, `Item.create` and deletes append an op to the new `pending_writes` table (migrations 0020 and 0021), and the leader tab applies ops in order, retrying a busy database and marking any other failure `failed` with its error. Without a leader (Node, no Web Locks) every tab applies, each op at most once. An edit survives a reload before it applies. Applied ops are pruned.
- Reads include edits not yet applied: an item's property list, `getItemData`, the edited-properties list and Html, File and Image values show a pending op's value over the stored row, so a storage value shows after a reload before its op applies. The local query data source reads published rows only.
- The outbox checks item ownership before applying an op, and checks a Relation value's local targets: a target whose create is still pending makes the op wait, and a missing one fails it with `RelationTargetError`.
- Sync keeps a local draft when it brings a newer value for the same property, and records the conflict: `property.conflict` holds the synced value (`remoteValue`), the `itemProperty.conflict` event fires, and `property.resolveConflict('local' | 'remote')` keeps the draft or drops it so the synced value shows. A new edit clears the conflict. Before, sync overwrote the draft.
- New `BaseDb.transaction(fn)`: every query `fn` runs on its `tx` commits together or not at all. When another connection holds the database lock the whole transaction is retried, so `fn` must have no other side effects.
- SQLocal is upgraded from 0.16 to 0.18.
- New `property.showValue(value)` shows a value without saving it, for input that saves later; the next `setValue` saves, and if that save fails the property shows what it did before the first `showValue`. React's `useDebouncedItemProperty` uses it.
- `Item.all({ waitForReady: false })` builds each item without waiting for it to load. `Item.all` created each item with `Item.create`'s default, waiting for one after another; with `waitForReady` it now waits for them together.
- New exports `watchEntityChanges(watch, listener)` and `watchEntityRows(watch, read, onRows, options)` subscribe to the change feed (ADR 0020) for one seed's `seeds`, `versions` or `metadata` rows, and `isChangeFeedRunning()` says whether this tab has a feed (browser only). `@seedprotocol/react` uses them for `useItemProperties`.
- A write no longer re-runs a query for every loaded Item and ItemProperty. Each Item held two liveQueries and each ItemProperty one, and every write to `seeds`, `versions` or `metadata` re-ran all of them in every tab: 400 statements per create and 320 per property save with 40 items of 8 properties loaded, which held up any find or load issued meanwhile (563 ms for an uncached `Item.find` right after a create). Now migration 0023 adds an `entity_changes` table that triggers fill on every write to those tables, each tab runs one query on it, and only the entities whose seed was written re-read their rows (ADR 0020): 2 statements per create and 3 per save, and the same find takes 114 ms. The triggers add 1–3 ms to a write. Other tabs' writes still reach loaded entities. `BaseDb.liveQuery` and the React hooks' own liveQueries still re-run on every write to the tables they read; identical live queries now share one query and one initial read.
- `DEBUG=seedSdk:timing` logs how long item creates, finds and property saves spend in each phase (for saves: ownership check, schema lookup, the write, waiting for the property to settle; for `createNewItem`: model resolve, schema lookups, seed fields, applying the outbox op). It also logs when `Item.find`, `Item.create` or `Item.all` waited out a ready timeout and continued, naming the item and the properties still loading, and why `Item.find` returned `undefined`.
- `addresses.persisted` (`ADDRESSES_PERSISTED_EVENT`) fires only when the saved owned or watched addresses differ from the ones this tab last announced, compared without case or order (a stopped client forgets its last announcement). Before, every `setAddresses()` and every init that saved addresses fired it, so a wallet reconnecting with the same address made React's `useItems` reload its list from scratch.
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
- A schema file in the complete format (`$schema` and `metadata`) with no `metadata.name` fails init with `Could not load config.schema: Failed to parse JSON import content: Schema name is required (either at top level or in metadata.name)`. It failed with a raw SQL error (`Failed query: …`).
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

- Browser bundles no longer include the Node platform. It shipped as an unused lazy chunk of about 150 KB gzipped (libsql and its migrator), and broke webpack and Next.js server builds. The Node platform now loads through `#seed-node-platform`, a `package.json` `imports` entry that maps to the browser platform under the `browser` condition. Platform selection at runtime is unchanged, so jsdom still gets the browser platform.
- **Breaking: `@seedprotocol/vite` is an optional peer dependency** instead of a dependency, so installing the SDK no longer installs Vite, Rolldown and `vite-plugin-node-polyfills`. Apps that import `@seedprotocol/sdk/vite` must install `@seedprotocol/vite` themselves.
- `withSeed` from `@seedprotocol/sdk/node` is deprecated in favor of `@seedprotocol/next`, which covers Turbopack and sets the cross-origin isolation headers.
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
