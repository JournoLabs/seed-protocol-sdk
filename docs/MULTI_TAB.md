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
  Node always acts as leader.

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
    can't block others' init forever. The `multiTab` option and leader election are deferred to
    Phase B, where they're first needed; the Phase A locks are plain correctness fixes.
  - `prepareDb` holds `seed:migrate:<db>`; each migration and its `__drizzle_migrations` row run
    in one `SQLocal.transaction()` (0009 outside). Without the lock, two concurrent `prepareDb`
    calls fail with "duplicate column name" (`concurrentPrepareDb.test.ts`).
  - `saveConfig`, `processSchemaFiles` and `ensureModelStubs` (from `addModelsToDb`) hold
    `seed:init:<db>`. Without it, concurrent stub inserts duplicate rows (`ensureModelStubs.test.ts`).
  - **Behavior change:** init no longer saves an empty address list (`persistInitAddresses`).
    Stored addresses survive a reload with `addresses: []` until `setAddresses` replaces or
    clears them.
  - The drizzle driver retries `SQLITE_BUSY` / `SQLITE_LOCKED` (`sqliteBusyRetry.ts`).
- Phases B and C: not started.
