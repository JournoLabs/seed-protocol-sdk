# Changelog

All notable changes to this package are documented in this file.

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
