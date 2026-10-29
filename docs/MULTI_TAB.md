# Multiple tabs

All tabs of an origin share one SQLite database (`${filesDir}/db/seed.db`, opened by SQLocal) and
one OPFS tree. The browser SDK coordinates them so a second tab is safe and background work runs
once. The reasoning is in [ADR 0012](adr/0012-tabs-coordinate-through-web-locks.md).

## The `multiTab` option

`SeedConstructorOptions.multiTab` is `'coordinate'` (default) or `'off'`. With `'coordinate'`, one
tab is elected leader through the Web Lock `seed:leader:<db>`; when it closes or crashes, the next
waiting tab takes over. With `'off'`, without Web Locks, and in Node, every tab acts as leader.

## What runs where

The leader tab runs automatic EAS sync (on init, address changes and event-bus requests), the bulk
downloads and image resizing that follow it, and the Arweave L1 finalize worker. A non-leader tab that skips a sync request runs it once if it becomes leader, and
forwards address changes to the leader. `client.syncFromEas()` runs in the tab that calls it.

A publish runs in the tab that started it, which holds `seed:publish:<seedLocalId>`. When a tab
restores in-progress publishes, it skips any whose lock another tab holds, and
`PublishManager.createPublish` resolves `undefined` for a seed publishing elsewhere.

## Locks

These sections run one tab at a time, whatever `multiTab` is set to:

| Lock | Covers |
|---|---|
| `seed:migrate:<db>` | Recreating a database older than 0.7.7, migrations (each in one transaction) and their data backfills |
| `seed:init:<db>` | Config, schema-file processing and model stubs during init |
| `seed:eas-sync:<db>` | Every EAS sync run |
| `seed:publish:<seedLocalId>` | One publish |
| `seed:opfs-write:<path>` | A download worker's write to one file |
| `seed:item-storage:<file path>` | Every write to a draft's ItemStorage file, with its row |

The ItemStorage file lock is always the innermost: take it inside another lock, never the other way
round, and request no other lock while holding it.

A lock wait times out after 60 s with `TabLockTimeoutError` (`code: 'TAB_LOCK_TIMEOUT'`), so a hung
tab can't block the others' init. Without Web Locks the sections still run one at a time within the
process. The Drizzle driver retries `SQLITE_BUSY` and `SQLITE_LOCKED` for about a second.

Opening the database needs `seed.db`'s OPFS sync access handle, which another tab holds while it runs
queries. sqlite-wasm retries for about 4.5 s and SQLocal then opens an in-memory database instead, so
`prepareDb` closes it and opens again after 1, 2 and 4 s before failing with
`DatabaseNotPersistentError`.

## Keeping other tabs current

`BaseDb.liveQuery` already re-runs on other tabs' writes (SQLocal broadcasts changed tables).
Loaded Items and ItemProperties hear about them through the change log instead (ADR 0020):
triggers log every write to `seeds`, `versions` and `metadata` in `entity_changes`, SQLocal's
broadcast re-runs each tab's one `max(seq)` query on that table, and the tab's feed re-reads only
the entities whose seed changed. This needs no leader and works with `multiTab: 'off'`; the leader
prunes log rows older than 10 minutes. On top of that, tabs exchange messages over the
BroadcastChannel `seed:tabs:<db>`:

- **EAS sync finished, addresses persisted, local copies removed.** Other tabs emit the same event
  locally, after dropping their cached Items for removed local copies. Loaded Items already saw
  sync's rows through the change log.
- **Files changed.** Every file written, truncated or removed through ZenFS is announced once it is
  in OPFS. Paths are coalesced over 25 ms into messages of up to 500 paths and flushed on
  `pagehide`. Receivers refresh their ZenFS cache for those paths, and `FILES_CHANGED_EVENT`
  (exported) tells `useFiles` and `useImageFiles` to refetch. Download and resize workers write to
  OPFS directly and report their paths the same way.

Messages are posted only by the tab where the event happened and carry `from: TAB_ID`. Receivers
only refresh caches and never write, so nothing echoes back. A tab that misses a message still
sees a changed file's new size on its next async `stat()`.

The SQLite database and its journal are written by SQLocal's worker through its own OPFS VFS, so
they never produce file messages.

## Resetting local data

`client.resetLocalData()` ([GETTING_STARTED.md](./GETTING_STARTED.md#deleting-local-data)) has to
delete a database other tabs may have open. Each coordinating tab holds the Web Lock
`seed:open:<db>` in shared mode from the start of `client.init` until its database has closed. The
resetting tab stops its own client, requests `seed:open:<db>` exclusively, then posts `close-db` on
`seed:tabs:<db>`. A tab that hears it stops its client, as `client.stop()` does, and unmounts its file
system; its snapshot reads `status: 'stopped'`, `context.stopReason: 'reset'`. Once every tab has
let go, the reset holds the lock while it deletes, so an `init` in any tab waits for the delete to
finish before it opens the database again.

If a tab doesn't let go within `otherTabsTimeoutMs`, the reset deletes without the lock, and the
files that tab still has open (usually `seed.db`) come back in `failed`. That happens with a tab
using `multiTab: 'off'` (it has no channel and holds no lock), a tab running an SDK older than this
lock, or a tab whose stop hangs. A tab whose client was already stopped never hears `close-db`, so it
keeps its file-system mount; reload it before calling `init` there.

## What stays stale

Schema and Model metadata on existing instances, ModelProperty instances and module-level lookup
maps don't refresh when another tab edits a schema. Reload the page after editing schemas in
another tab.

## Not covered yet

No lock covers ordinary item edits, item creates or deletes, or schema and model edits, so two tabs
editing the same draft property can each write a draft row. Chain uids (`seeds.uid`,
`versions.uid`, `metadata.uid`) have no unique index.
