# Multiple Tabs

How the browser SDK behaves when one app is open in several tabs, and the plan for coordinating
them (October 2026). All tabs of an origin share one SQLite database (`${filesDir}/db/seed.db`,
opened by SQLocal) and one OPFS tree.

## Background

Same-device tabs are a coordination problem, not a merge problem: there is one database file and
nothing diverges, so CRDTs don't help here (they matter for syncing drafts across devices). The
primitive is the Web Locks API (`navigator.locks`). Unlike OPFS file locks, a Web Lock is managed
by the browser and released automatically when the tab holding it closes or crashes.

What the stack already provides:

- **SQLite's `opfs` VFS** (what SQLocal 0.16 uses) supports several connections to one database if
  each keeps transactions short and handles `SQLITE_BUSY`. SQLite's docs report 8–10 concurrent
  workers running reliably. Lock failures can also surface as I/O errors.
- **SQLocal 0.16** wraps every query and `batch` in a *shared* cross-tab Web Lock; only
  `SQLocal.transaction()` (and file overwrite/delete) take it exclusively. Reactive queries
  broadcast dirty tables to other tabs, so `BaseDb.liveQuery` already fires on other tabs' writes.
- **The SDK** broadcasts `seed-schemas-invalidate` and `seed-models-invalidate` between tabs.

## What goes wrong with two tabs today

Ranked by damage:

1. **Publishes resume in every tab.** Importing `@seedprotocol/publish` restores every
   `in_progress` `publish_processes` row and starts it (`publishManager/index.ts`,
   `restoreFromDb.ts`). A second tab opened mid-publish becomes a second publisher: duplicate
   Arweave uploads and attestation transactions, nonce conflicts.
2. **Migrations aren't protected.** `applyEmbeddedMigrations` runs statement by statement with no
   transaction and no lock, and the migration SQL has no `IF NOT EXISTS`. Two tabs upgrading at
   once can fail with "duplicate column" or apply data migrations twice.
   `resetAmbiguousLegacyItemData` can delete tables while the other tab writes.
3. **Every tab runs EAS sync on every init**, even with `syncFromEasOnAddressChange` off
   (`addModelsToDb.ts` → `requestEasSyncFromModelsInit`). Sync checks what exists, then inserts the
   rest; `seeds.uid`, `versions.uid` and `metadata.uid` have no unique index, so concurrent syncs
   create duplicate rows.
4. **Init writes race.** Model stubs, schemas and model–schema links are check-then-insert
   (`models.name` isn't unique; `linkModelToSchema`'s `pendingLinks` guard is per tab).
5. **`saveConfig` wipes addresses.** It writes the init option's addresses, or an empty list if
   none were passed, so a new tab can clear the addresses another tab connected. A bug with one tab
   too.
6. **Duplicate file work.** Bulk downloads, image resizing and the Arweave L1 finalize worker (45 s
   poll) run in every tab. Worker writes in one tab can hit the other's sync access handles, and
   `excludedTransactions` is overwritten wholesale (last writer wins).
7. **Other tabs miss some changes.** "EAS sync finished", `file-saved` and "addresses saved" go
   through the in-process `eventEmitter` only, and each tab's ZenFS cache (filled at mount by
   `crossCopy`) doesn't see files other tabs write.

## Plan (Tier 1: one leader tab, Web Locks)

### Building block

`packages/sdk/src/browser/helpers/tabCoordinator.ts`:

- **Leader election:** `navigator.locks.request('seed:leader:<dbPath>', …)` held for the tab's
  lifetime; the next queued tab takes over when it closes.
- **API:** `isLeader()`, `whenLeader()`, `onLeaderChange(cb)`; `withLock(name, fn)` for named
  exclusive sections; `lockIfFree(name)` for "skip if another tab is already doing it".
- **Cross-tab events:** BroadcastChannel `seed:events:<dbPath>` forwarding selected event-bus events.
- **Off switch:** `multiTab?: 'coordinate' | 'off'` on `SeedConstructorOptions`, default
  `'coordinate'`. With `'off'`, or without Web Locks, every tab acts as leader (today's behavior).
  Node always acts as leader. Without Web Locks (Node < 24.5), `withTabLock` sections still run one
  at a time within the process (`withProcessLock` in `helpers/tabLocks.ts`).

### Phase A: make a second tab safe

1. **Migrations under a lock.** `applyEmbeddedMigrations` inside `withLock('seed:migrate:…')`,
   re-reading the last applied migration once held; `backfillMetadataPropertyIds` and
   `resetAmbiguousLegacyItemData` in the same lock. Each migration in `SQLocal.transaction()`
   except 0009, whose `PRAGMA foreign_keys` is a no-op inside a transaction.
2. **Serialize init writes.** `copyDrizzleFiles`, `saveConfig`, `processSchemaFiles` and the
   model-stub inserts in `addModelsToDb` inside `withLock('seed:init:…')`, so check-then-insert
   steps see the other tab's rows. A second tab waits a few seconds for the first's init writes.
3. **Fix the `saveConfig` addresses bug.** Keep stored addresses when init options have none.
4. **Retry `SQLITE_BUSY`** in the drizzle driver (`createSqlocalDrizzle.ts`), about 1 s of backoff.
   Safe because the SDK writes single statements and a failed statement didn't apply.

### Phase B: background work only once

5. **Publishes: a lock per publish.** The tab running a publish holds `seed:publish:<seedLocalId>`;
   restore resumes only rows whose lock is free. A publish started in a non-leader tab keeps running
   there.
6. **EAS sync.** Automatic triggers (init, address change, event bus) run only in the leader.
   Non-leader address saves are forwarded so the leader syncs the right addresses (its in-memory
   addresses never refresh from the DB today). Explicit `client.syncFromEas()` runs in the calling
   tab. Every sync runs under `withLock('seed:eas-sync:…')`.
7. **Files.** Bulk download and resize follow EAS sync, so they become leader-only. On-demand
   downloads stay per tab under `seed:file:<txId>`. `excludedTransactions` becomes
   read-merge-write under a lock.
8. **L1 finalize worker** starts from `whenLeader()` instead of `initPublish`.

### Phase C: keep other tabs current

9. **Forward events across tabs:** EAS sync finished (reload cached Items, refresh React queries),
   file saved/downloaded, addresses saved.
10. **Refresh the ZenFS cache:** `TolerantWebAccessFS.invalidate(path)` on forwarded file events.
    Required by step 7 — non-leader tabs must see files the leader downloads.
11. **Left stale on purpose:** Schema and Model metadata on existing instances, ModelProperty (no
    live query), module-level lookup maps (`schemaStringToModelRecord`, content-URL maps). Only
    another tab's schema edits make these stale.

### Testing

- **Browser unit tests:** two `tabCoordinator` instances in one page contend for real (Web Locks
  are per origin): leader handover, `lockIfFree`, two concurrent `prepareDb` calls.
- **Two-tab end-to-end (Playwright):** concurrent init with no errors or duplicate rows; one EAS
  sync with no duplicate `seeds`/`versions`/`metadata`; one tab resumes an in-progress publish; a
  non-leader tab reads a file the leader downloaded; leadership moves when the leader closes.

### Not in Tier 1

- Unique indexes on chain uids (needs a dedupe migration and placeholder-uid handling).
- Skipping ZenFS's whole-OPFS preload (needs an audit of sync fs calls).
- The legacy `'file-saved'` resize worker in `browser/index.ts`, which looks broken.
- Tier 2: routing all queries through the leader tab's worker (Notion / wa-sqlite pattern), which
  would allow the faster `opfs-sahpool` VFS. SharedWorker only returned to Chrome for Android in
  148–151, so it would need a fallback.

## Status

- **Phase A: done.**
  - `packages/sdk/src/helpers/tabLocks.ts` provides `withTabLock` / `withSeedDbLock`. Lock waits
    time out after 60 s with `TabLockTimeoutError` (`code: 'TAB_LOCK_TIMEOUT'`), so a hung tab
    can't block others' init forever. The Phase A locks are plain correctness fixes and apply
    regardless of `multiTab`.
  - `prepareDb` holds `seed:migrate:<db>`; each migration and its `__drizzle_migrations` row run
    in one `SQLocal.transaction()` (0009 outside). Without the lock, two concurrent `prepareDb`
    calls fail with "duplicate column name" (`concurrentPrepareDb.test.ts`).
  - `saveConfig`, `processSchemaFiles` and `ensureModelStubs` (from `addModelsToDb`) hold
    `seed:init:<db>`. Without it, concurrent stub inserts duplicate rows (`ensureModelStubs.test.ts`).
  - Init with an empty address list no longer wipes another tab's stored addresses
    (`persistInitAddresses`). Phase A skipped the write in every tab; Phase B narrowed it to
    non-leader tabs. Keeping stale addresses in a lone tab made drafts created before the wallet
    reconnected read-only (unstamped drafts aren't owned while owned addresses are stored), so
    the first tab clears them as before.
  - Init with no `addresses` option at all keeps the stored addresses in every tab, and warns once
    when there are any. Only an explicit `addresses: []` clears them, and only in the leader tab.
  - The drizzle driver retries `SQLITE_BUSY` / `SQLITE_LOCKED` (`sqliteBusyRetry.ts`).
- **Phase B: done.**
  - `packages/publish/src/services/publishManager/publishLocks.ts`: the tab running a publish holds
    `seed:publish:<seedLocalId>`. Restore skips rows another tab holds; `PublishManager.createPublish`
    resolves `undefined` for a seed publishing in another tab; done, `stopPublish`, `stopAll` and
    tab close release it. `stopAll` leaves rows `in_progress`, so the next tab to restore may resume
    them (as before).
  - `packages/sdk/src/helpers/tabCoordinator.ts`: leader election (`isLeaderTab`, `whenLeaderTab`,
    tab messages over `seed:tabs:<db>`), started in `platformClassesInit`.
    `SeedConstructorOptions.multiTab` defaults to `'coordinate'`; `'off'` keeps every tab a leader.
    Node and pre-init code act as leader.
  - EAS sync: models-init and event-bus requests run in the leader; a non-leader remembers a skipped
    request and runs it once if it takes over. Address changes are forwarded to the leader.
    `client.syncFromEas()` runs in the calling tab (decision: run locally under the lock rather than
    forward). Every run holds `seed:eas-sync:<db>` with no wait timeout.
  - The L1 finalize worker starts from `whenLeaderTab()`.
  - Files: instead of a per-transaction lock in the lazy-download path, the download worker locks
    `seed:opfs-write:<path>` around each write, which covers bulk and lazy downloads in every tab.
    `addExcludedTransactions` replaces the two whole-list overwrites.
  - Bulk download and resize follow EAS sync, so automatic ones now run in the leader only.
  - The one-time legacy ItemStorage migration (`db/migrateLegacyItemStorageRows.ts`, writes
    content stored verbatim in `metadata.property_value` to its file) starts after client init in
    the leader only, under `seed:item-storage-migration:<db>`; a tab that takes over runs it, and
    an appState marker (`legacyItemStorageFiles:v1`) stops later runs.
  - ItemStorage files: every writer of a local draft's file (`saveItemStorage`, the legacy-row
    conversion used by that migration and by publish, `createNewItem`) holds
    `seed:item-storage:<absolute file path>` (`withItemStorageFileLock` in
    `helpers/itemStorageFile.ts`) across reading the row, writing the file and updating the row; the
    conversion re-reads the row under the lock and skips one a save already converted. Without it a
    save landing between the conversion's read and its file write had its file overwritten with the
    legacy content. The file lock is always innermost: it may be taken under
    `seed:item-storage-migration:<db>` or `seed:publish:<seedLocalId>`, never the reverse, and no
    other lock is requested while it is held. Downloads write `<txId><ext>` files, never a draft's
    `<seedUid or seedLocalId><ext>`, and keep their own `seed:opfs-write:<path>` lock.
- **Phase C: done.**
  - `packages/sdk/src/helpers/tabEvents.ts`. `emitAcrossTabs` sends EAS sync finished, addresses
    persisted and local copies removed to other tabs, which first reload
    (`Item.rehydrateCachedItemsFromDbAfterEasSync`) or drop (`Item.dropCachedInstancesForSeedIds`)
    cached Items, then emit the same event. Events are posted only where they originate, so
    nothing is relayed twice.
  - Files: `file-saved` stays a local event (the legacy resize listener in `browser/index.ts` would
    otherwise spawn a worker in every tab).
  - Every file write that goes through ZenFS is announced to other tabs from the mount itself:
    `TolerantWebAccessFS.onOpfsChange` fires for each file it writes, truncates or removes (a rename
    is a removal plus a write) once the change is in OPFS, and `BrowserFileManager` routes it to
    `queueFilesChangedNotice` (`helpers/tabEvents.ts`). That covers `saveFile` / `saveFileSync`
    (item-storage files, schema and `updateSchema` writes, `imports/json`,
    `htmlEmbeddedDataUriPublish`, the save actors) and code using `fs.promises` / `fs.*Sync`
    directly (`fetchAll`, the schema unlink, sync-API fallbacks) without a call per writer. The
    save actors' `notifyFileSaved` now only emits `file-saved` locally; its message was a duplicate
    and, for the sync-API fallbacks, went out before OPFS had the data. Sync-API writes are
    announced when their queued OPFS write lands, not when `writeFileSync` returns.
  - Coalescing: paths gather in a set for `FILES_CHANGED_FLUSH_MS` (25 ms, counted from the first
    path, so a steady stream still sends once per window) and go out as one `files-changed`
    message, split at `FILES_CHANGED_MAX_PATHS` (500). A save's several ZenFS calls (truncate,
    write, sync) and bulk writes (migration files, schema processing, downloads) send a few
    messages, not one per write. Queued paths are flushed on `pagehide`. Nothing is queued unless
    the tab coordinates (Node, `multiTab: 'off'`, no Web Locks: no-op).
  - Every tab message carries `from: TAB_ID`; the channel handler drops messages with this tab's
    id (a BroadcastChannel never hears itself, but a second channel object in the page would).
  - Receivers only refresh caches (`BaseFileManager.invalidateCachedPaths`, serialized per tab):
    invalidation reads OPFS and never writes it, so it never fires `onOpfsChange` and no message is
    sent back. A path the tab never had, or that's gone, costs one failed lookup and drops whatever
    was cached under it.
  - Database files: the SQLite database and its journal/WAL are written by sqlocal's worker through
    its own OPFS VFS, not through ZenFS, so they never produce messages (SQLite does its own
    locking, and `stat()` already tolerates their size changing under the mount). The drizzle
    migration, journal and snapshot files `Db.prepareDb` writes through `saveFile` are ordinary
    small files and are announced (one coalesced message per init).
  - The download and resize workers write to OPFS directly, so even the tab that ran them had stale
    ZenFS entries for rewritten files; they report saved paths, and `notifyFilesWrittenOutsideCache`
    refreshes this tab and queues the same notice for the others.
  - All of this is defense in depth: a tab that misses a message still sees the change on its next
    async `stat()` (below). What it adds is the sync API's in-memory copy, which `stat()` only
    refreshes when something stats the file.
  - `TolerantWebAccessFS.invalidate(path)` (via `BaseFileManager.invalidateCachedPaths`) drops a
    path's index entry, handle and in-memory copy and reads it again. Without it, a file rewritten
    elsewhere read back at its old size ("version two" → "ve"). Directories the in-memory copy lacks
    (created by another tab after this one mounted) are added, so the sync API finds new files too.
  - Without an invalidation, `TolerantWebAccessFS.stat()` re-reads a file's size from OPFS (one
    `getFile()`) and refreshes the index and in-memory copy when OPFS changed since the mount last
    looked, so async opens, appends and reads see files other tabs or workers grew. Writes only
    shrink an OPFS file for a truncate made through that mount (open `'w'`, `truncate()`), never
    because the cached size is smaller. Sync-API writes still use the in-memory copy's position.
  - `FILES_CHANGED_EVENT` (exported) tells `useFiles` / `useImageFiles` to refetch.
  - Two-tab end-to-end test: `browser/multiTab.e2e.test.ts` opens real Playwright pages
    (`__tests__/e2e/multiTab/tab.html`) through browser commands in `vite.config.js`. It checks
    concurrent init, a single leader, a file rewritten behind ZenFS reading fresh in the other tab,
    saves (async and sync API) reaching the other tab's `readFileSync` with no stat there, bulk
    saves coalescing into few messages, no echo, and leadership handover. Publish restore across tabs is covered by `publishLocks.node.test.ts`
    rather than this test, since a real publish needs a chain.
  - Still stale on purpose (step 11): Schema/Model metadata on existing instances, ModelProperty,
    module-level lookup maps.
