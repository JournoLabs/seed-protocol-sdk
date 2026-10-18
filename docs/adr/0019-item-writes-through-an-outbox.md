# 0019. Item edits go through a durable outbox that the leader tab drains

- **Status:** Accepted (being implemented)
- **Date:** 2026-10-18
- **Scope:** `@seedprotocol/sdk` (Item, ItemProperty, `db/write`, `BaseDb`, EAS sync, migrations),
  `@seedprotocol/react` (property hooks), `@seedprotocol/publish` (payload, uid stamping)

## Context

`item.title = 'x'` updates the property in memory and starts a save that writes `metadata` (and,
for a new item, `seeds` and `versions`) with a series of separate statements. Nothing groups them:
the SDK runs no SQL transactions outside migrations. `Item.create` undoes a half-written draft with
`discardNewDraft`. `propertyWriteQueue` orders plain value writes to one property within one tab
and skips superseded ones, but it lets Html, File, Image and ItemStorage saves go before their
actors write, and it doesn't see other tabs: two tabs editing one draft property each insert a
draft row. A value assigned just before a reload is lost if its write hadn't run. Rejected saves
roll back by several separate paths (`_valueBeforeSave`, `saveFailed`,
`saveValueValidationError`), and sync ingest decides between a pending local edit and a synced
row only by comparing `createdAt`.

Schema, Model and ModelProperty edits are rare, span files and versions, and already check for
conflicts; this decision doesn't cover them.

## Decision

**An outbox table.** User edits to items are appended as ops to `pending_writes`: `op_id`
(unique), `group_id`, `seed_local_id`, `property_name`, `kind` (`create`, `set`, `delete`,
`storage`), `value`, `value_ref` (a staged file for storage values), `base_row_id` and `base_uid`
(the stored row the edit was made against), `created_at`, `tab_id`, `status` (`pending`,
`applied`, `superseded`, `failed`), `error`, `attempts`, `applied_at`, and `conflict` (JSON, see
below). Ops for one `(seed_local_id, property_name)` apply in append order (the row id), and a
property waits behind its oldest pending op, including one waiting for a retry.

**Assignment.** The setter checks the value's type and shape synchronously and throws a
`TypeError` on a mismatch, before anything changes; documented coercions (a numeric string for
Number, an ISO string for Date, a JSON array string for List) don't throw. A value of the right
type that breaks a rule (length, range, enum, pattern, required) is kept in memory with its errors
on `property.validation` and is not appended; `save()` rejects with
`ItemPropertySaveValidationError`, and the value is lost on reload. A valid value updates memory
and appends one op. Async rules (ownership, relation targets) run when the op is applied.

**Draining.** The leader tab (ADR 0012) drains the outbox. Other tabs append and post a nudge on
the existing BroadcastChannel. This is an exception to ADR 0012's rule that receivers never write:
the leader drains a shared table in response, and the nudge carries no data, so nothing echoes.
Without a leader (multi-tab coordination off, no Web Locks, Node) every tab drains, so the drainer
claims an op by moving it out of `pending` inside the transaction that applies it, and an op is
applied at most once. On start the leader resumes every `pending` op.

**Applying an op** runs the existing writers (`updateItemPropertyValue`, `createMetadata`, the
storage pipelines) and marks the op `applied` in one transaction. Superseded ops are coalesced:
of a property's run of pending value ops (`set`, `storage`) only the newest is applied, and older
ones become `superseded`. An op that never applies has its applier's `discard` step run (a storage
value's file is deleted).
Transient errors (`SQLITE_BUSY`, I/O) retry with backoff; validation and ownership failures mark
the op `failed` with its error, and the in-memory value falls back to the next value in the
overlay (a newer pending op, else the stored row).

**Assignment order.** A save does async work before it appends (the ownership check, writing a
file), so append order alone could let an older save that finishes last win. A save takes a ticket
when it starts (`helpers/propertyWriteTickets.ts`) and appends only if no newer save of the
property has started in its tab; otherwise it drops its value and any file it wrote. Across tabs,
append order is the order.

**Draft history: latest value only.** Coalescing keeps one value per property in `metadata`.
Superseded and applied ops stay as rows and are pruned on a schedule, so an edit history can be
added later by keeping them.

**A pending local edit wins over a synced value, and the conflict is recorded.** When an op is
applied and sync has written a newer attested row since `base_row_id`, the op is applied on top
of it (a new draft over the synced version, as `updateItemPropertyValue` already does over an
attested row), and the op records `{ seedLocalId, propertyName, baseValue, remoteValue,
localValue, remoteUid }` in `conflict`. It is exposed as `property.conflict`, as an event, and
through `item.conflicts()`, and cleared by the next local edit or `resolveConflict('local' |
'remote')`. Rows with an unresolved conflict are not pruned. For whole-value sets this replay is
the same as "local wins"; a field-level merge (lists, rich text) needs finer ops and is not part
of this decision.

**Reads.** A property's value is its newest pending op if it has one, else the stored row. The
metadata liveQuery's `hasPendingPropertyWrite` check becomes this rule. SDK read helpers that
build item values apply the same overlay; raw SQL and liveQueries over `metadata` see a value
once it is applied.

**`await property.save()`** resolves when its op is applied and rejects when it fails. An
assignment without `save()` returns at once.

**`Item.create`** appends one op group (seed, version, metadata rows) applied in one transaction,
replacing `discardNewDraft`.

**Storage values.** An Html, File or Image value is a new storage seed: its id is chosen first and
its file written at its final path, named after it, so nothing else uses the file before the op
applies; applying creates the seed, its version and the property row. An ItemStorage value goes in
the item's own file, which other writers also touch, so it is written to a staging file; applying
moves it into place and updates the draft row. That op's applier takes the file's lock (ADR 0012)
around the transaction, the order the file's other writers use. SQLocal's transaction then takes its
own shared Web Lock while the file lock is held, an exception to ADR 0012's rule that nothing is
requested inside it; shared locks can't deadlock with each other.

**Other writers.** Sync ingest follows the conflict rule. Publish waits for a seed's pending ops to
apply before building its payload. `claimUnpublishedDrafts` stamps pending ops' publisher.
`removeLocalCopiesForAddresses` and purges delete the seed's ops. A property rename rewrites
pending ops that use the old name.

**Transactions.** `BaseDb.transaction(fn)` runs Drizzle queries atomically on both platforms: in
the browser through SQLocal's `transaction()` (Drizzle's own `db.transaction()` doesn't isolate
over the SQLocal driver), in Node through the libsql driver's `db.transaction()`. A transaction
that fails with `SQLITE_BUSY` is retried as a whole; the per-statement busy retry never runs
inside one. SQLocal is upgraded from 0.16 to 0.18 for `tx.batch` inside transactions and the
faster reactive bulk writes. From 0.17 SQLocal leaves cross-connection locking to SQLite, so
cross-tab contention surfaces as `SQLITE_BUSY`. In Node, libsql gives each transaction its own
connection, so the database runs in WAL mode (readers don't block a commit) and libsql's
`execute` and `batch` get the same per-statement busy retry as the browser driver.

## Consequences

An assigned value survives a reload, two tabs editing one draft produce one row, and a refused
save shows its error and the previous value by one path. `propertyWriteQueue` becomes the
assignment-order tickets; `_valueBeforeSave`, the separate rollback paths,
`reconcilePropertyDraftRows` and `discardNewDraft` go. React's
`useDebouncedItemProperty` assigns through the setter instead of sending machine events.

The drainer applies one unit at a time, so an ItemStorage op waiting for its file's lock (held by
the legacy-row migration, say) holds up every op behind it until the lock is free or its wait
times out.

Writes reach `metadata` later than today, by the drain delay: code that reads `metadata` with raw
SQL right after an assignment must await `save()` first. Writes made while no tab is the leader
wait for one. The outbox table grows until pruned. Tests that wait on `writeStatus` or send `save`
events directly are rewritten.

## Alternatives considered

- **Keep `propertyWriteQueue` and extend it to storage saves and other tabs.** Fixes ordering in
  one tab but not durability across a reload, and cross-tab ordering would need the same shared
  table.
- **Keep every op as edit history.** Deferred: a typing burst writes dozens of ops, and nothing
  reads history yet. The rows are kept so it can be added.
- **A synced value wins over a pending local edit.** Loses typing when sync runs mid-edit.
- **Route every write through one worker in the leader tab** (ADR 0012's deferred Tier 2). A
  larger change that also moves reads; the outbox works with each tab's own connection.
- **Drizzle's `db.transaction()` in the browser.** Not isolated over the SQLocal driver.
