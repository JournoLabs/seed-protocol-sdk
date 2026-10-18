# 0012. Browser tabs coordinate through Web Locks and one leader tab

- **Status:** Accepted
- **Date:** 2026-10-18 (records decisions made and implemented in October 2026)
- **Scope:** `@seedprotocol/sdk` (`helpers/tabCoordinator.ts`, `helpers/tabLocks.ts`, `helpers/tabEvents.ts`, init, EAS sync, file workers), `@seedprotocol/publish` (`publishManager/publishLocks.ts`, L1 finalize worker)

## Context

Every tab of an origin opens the same SQLite file (`${filesDir}/db/seed.db`, through SQLocal) and
the same OPFS tree. Nothing diverges between tabs, so this is a coordination problem, not a merge
problem, and CRDTs don't apply. Before this decision a second tab caused real damage: it resumed
in-progress publishes (duplicate uploads and attestations), ran migrations concurrently ("duplicate
column"), ran its own EAS sync (duplicate rows, since chain uids have no unique index), raced init's
check-then-insert writes, cleared stored addresses, and repeated file work.

The Web Locks API is the primitive: the browser manages the lock and releases it when the holding
tab closes or crashes, which OPFS file locks don't guarantee.

## Decision

**Leader election.** Each tab requests `seed:leader:<db>` and holds it for its lifetime; the next
queued tab takes over when the leader closes. `SeedConstructorOptions.multiTab` is
`'coordinate'` (default) or `'off'`. With `'off'`, without Web Locks, in Node, and before init,
every tab acts as leader.

**Leader-only background work.** Automatic EAS sync (init, address change, event bus), bulk
downloads and resizing that follow it, the legacy ItemStorage migration and the Arweave L1
finalize worker run only in the leader. A non-leader remembers a skipped sync request and runs it
once if it becomes leader, and forwards address changes to the leader. An explicit
`client.syncFromEas()` runs in the calling tab.

**Named exclusive locks** (`withTabLock` / `withSeedDbLock`), each scoped to the database:
`seed:migrate` (migrations and their data backfills, each migration in one transaction),
`seed:init` (config, schema processing, model stubs), `seed:eas-sync`, `seed:publish:<seedLocalId>`
(held by the tab running that publish; restore skips rows another tab holds),
`seed:item-storage-migration`, `seed:opfs-write:<path>` (download workers) and
`seed:item-storage:<file path>` (every writer of a draft's ItemStorage file). The ItemStorage file
lock is always innermost: it may be taken inside the migration or publish locks, never the
reverse, and no lock is requested while it is held. Waits time out after 60 s with
`TabLockTimeoutError` (`TAB_LOCK_TIMEOUT`). Without Web Locks the sections still run one at a time
within the process.

**SQLITE_BUSY.** The Drizzle driver retries `SQLITE_BUSY` and `SQLITE_LOCKED` for about a second.

**Cross-tab events.** Messages go over the BroadcastChannel `seed:tabs:<db>`, are posted only by
the tab where the event originated, and carry `from: TAB_ID`. EAS sync finished, addresses
persisted and local copies removed make other tabs reload or drop cached Items. File writes made
through ZenFS are announced from the mount, coalesced over 25 ms into messages of at most 500
paths, and flushed on `pagehide`. Receivers only invalidate caches and never write, so nothing
echoes. `FILES_CHANGED_EVENT` tells file hooks to refetch.

**Left stale on purpose.** Schema and Model metadata on existing instances, ModelProperty
instances and module-level lookup maps only go stale when another tab edits a schema, which is
rare.

## Consequences

A second tab is safe and does no duplicate background work. A tab's init can wait a few seconds
for another tab's init writes. Code that adds background work must decide whether it is
leader-only, and code that adds a lock must respect the innermost rule for the ItemStorage lock.

No lock covers ordinary item edits, item creates or deletes, or schema and model edits; two tabs
editing one draft property can each insert a draft row. Unique indexes on chain uids are not in
place. Both are open.

SQLocal 0.16 takes a shared cross-tab lock for each query and an exclusive one for
`transaction()`. SQLocal 0.17 stops blocking two connections from starting transactions at once and
leaves locking to SQLite, so an upgrade relies more on the `SQLITE_BUSY` retry.

## Alternatives considered

- **Route all queries through one leader tab's worker** (the Notion and wa-sqlite pattern, which
  would also allow the faster `opfs-sahpool` VFS). Deferred: much larger change, and SharedWorker
  only recently returned to Chrome for Android, so it needs a fallback.
- **CRDTs.** Don't fit: one file, no divergence.
- **Per-transaction download locks.** Replaced by a lock around each OPFS write, which covers bulk
  and on-demand downloads in every tab.
