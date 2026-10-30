# 0019. Item edits go through a durable outbox that the leader tab drains

- **Status:** Accepted; amended 2026-10-22 (the setter appends at once; see Assignment, Assignment
  order and Storage values), 2026-10-27 (the setter never throws; see Assignment) and 2026-10-29
  (an edit back to the attested value leaves no draft; see that section)
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
(unique), `seed_local_id`, `property_name`, `kind` (`create`, `set`, `delete`, `storage`),
`value`, `base_row_id` (the stored row the edit was made against), `created_at`, `tab_id`,
`status` (`pending`, `applied`, `superseded`, `failed`), `error`, `attempts`, `applied_at`, and
`conflict` (JSON, see below). The table also has `group_id`, `value_ref` and `base_uid` columns
that nothing writes. Ops for one `(seed_local_id, property_name)` apply in append order (the row id), and a
property waits behind its oldest pending op, including one waiting for a retry, except that a run
of value ops waits for its newest op only (the older ones are superseded with it). An op on the seed
itself (no property: create, delete) is ordered against all of its seed's ops.

**Assignment.** The setter never throws (amended 2026-10-27; it was to throw a `TypeError` on a
type mismatch). It shows the value at once and checks it against the property's definition: a
value of the wrong type and one that breaks a rule (length, range, enum, pattern, required) are
handled alike. Such a value stays shown with its errors in `saveValidationErrors` and is not
appended; `save()` rejects with `ItemPropertySaveValidationError`, and the value is lost on reload.
A non-empty string assigned to a List is stored as a one-element list. An empty Image, File or Html
value clears the property (ADR 0021). A valid value appends one op before the setter
returns. If planning the op fails for another reason (no definition found for the property, no
local seed), the stored value is shown again and `save()` rejects with that error. Ownership is
checked in the applier's `prepare` step (the op may come from another tab or from before a reload,
and the client may have lost the item's wallet since), so a refused assignment appends an op that
fails. `save()` still checks ownership before it waits.
Creates and discards are not checked. A `set` op's Relation value is checked there too: each seed it
names by local id must exist (an attestation uid passes, since a related seed may have no local
copy). A target whose create op is still pending defers the op; any other missing target fails it
with `RelationTargetError`. Whether a target is of the relation's model is not checked.

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
Transient errors (`SQLITE_BUSY` or a busy file) retry
with backoff; anything else (a broken rule, ownership, a constraint) marks the op `failed` with
its error and the error's name (`error_name`) at once, so a waiter can rethrow `OwnershipError`, and the in-memory value falls back to the next value in the
overlay (a newer pending op, else the stored row). A loaded property's change-feed read shows the
overlay whether or not a write of it is in flight (decision D2; see ADR 0020's amendment).

**Assignment order.** The setter does no async work before it appends, so append order is
assignment order, in a tab and across tabs. (Until 2026-10-22 a save checked ownership and wrote
its file first, and took a ticket, `propertyWriteTickets`, so an older save that finished last
couldn't win.) A setter that lacks something to plan the op (the property's definition, the seed's
local id, the file system) shows the value and appends once it has it; the property's later
assignments queue behind it.

**Draft history: latest value only.** Coalescing keeps one value per property in `metadata`.
Superseded and applied ops stay as rows and are pruned on a schedule, so an edit history can be
added later by keeping them. The leader prunes after a drain, at most hourly: applied and
superseded ops after a day, failed ops after a week.

**A pending local edit wins over a synced value, and the conflict is recorded.** When an op is
applied and sync has written a newer attested row since `base_row_id`, the op is applied on top
of it (a new draft over the synced version, as `updateItemPropertyValue` already does over an
attested row), and the op records `{ seedLocalId, propertyName, baseValue, remoteValue,
localValue, remoteUid }` in `conflict`. It is exposed as `property.conflict`, as an event, and
through `item.conflicts()`, and cleared by the next local edit or `resolveConflict('local' |
'remote')`. Rows with an unresolved conflict are not pruned. A row with the base row's uid (the same
attestation synced again) is not a conflict, nor is a synced value equal to the base value or to
the edit's. When the edit had no base row, only an attested row written after the edit counts.
`resolveConflict('remote')` deletes the property's local draft rows through a `delete` op, so the
synced row is the newest again. The `itemProperty.conflict` event fires in the tab that made the
edit, or that ran the sync; other tabs see the conflict when they load the property. Storage ops carry no base row and
record no conflicts. For whole-value sets this replay is
the same as "local wins"; a field-level merge (lists, rich text) needs finer ops and is not part
of this decision.

**An edit back to the attested value leaves no draft** (amended 2026-10-29). When a `set` op
applies and its value equals the property's latest attested row (`propertyValuesEqual`: a Relation,
Image, File, Html or Json value by the seed it names, so a local id equals that seed's uid, and a
List member by member in order), the applier deletes the property's drafts instead of writing one.
The attested row is the current row again, so the pending diff, the cost estimate and publish leave
the property out, and nothing marks a draft as published. The comparison is with the latest
attested row, not the op's base row: once sync has written a newer value, going back to the old one
is an edit and wins under the rule above. A clear, a revoked attested row, and a row above it that
a publish in progress holds (a placeholder uid) keep the usual write. The setter still appends the
op: the comparison reads the stored rows, which the applier reads in its transaction. Drafts
written before this amendment that equal the attested value stay, and the next publish attests
them.

**Reads.** A property's value is its newest pending op if it has one, else the stored row. The
metadata liveQuery's `hasPendingPropertyWrite` check becomes this rule. SDK read helpers that
build item values apply the same overlay (`getPendingPropertyRows`): an ItemProperty's load and
hydrate, and `getItemProperties` (so `getItemData` and `getEditedProperties`), where an overlaid
value counts as an unpublished edit. A pending storage value shows its row: an Html value its text,
which the op carries; an Image or File value its file once the op is prepared; an ItemStorage
value is read from its staged file until the op moves it. The local query data source reads published rows only and has no overlay. Raw SQL
and liveQueries over `metadata` see a value once it is applied.

**`await property.save()`** resolves when its op is applied and rejects when it fails. An
assignment without `save()` returns at once.

**`Item.create`** appends one `create` op (seed, version, a row per property, ItemStorage initial
values staged) applied in one transaction, so a failure leaves nothing. When a later step of
`Item.create` fails (an initial storage value is refused), a `delete` op in `discard` mode removes
the draft, in order after its pending ops; it replaces `discardNewDraft`. `Item.destroy` and
`ItemProperty.destroy` are `delete` ops too.

**Storage values.** An Html, File or Image value is a new storage seed: its id is chosen when the
value is assigned. A string value (a URL, a file name, the text) goes in the op; a Blob's or a
`data:` URL's bytes go to a staged file named in the op's `value_ref`, which the assigning tab
writes right after appending, holding a lock named for the file. Preparing the op turns the value
into content, writes the file at its final path, named after the seed so nothing else uses it, and
deletes the staged file once the op applied; applying creates the seed, its version and the
property row. A staged file that is missing while nobody holds its lock was never written (the tab
closed or the write failed): the op fails with `StagedValueMissingError`. An ItemStorage value goes in
the item's own file, which other writers also touch, so it is written to a staging file; applying
moves it into place and updates the draft row. The op carries a string value too, so a staged file
its tab never wrote is written again from the op. That op's applier takes the file's lock (ADR 0012)
around the transaction, the order the file's other writers use, but only when the lock is free:
when another writer holds it, the op throws `OutboxOpDeferredError` and the drainer sets it aside
for `OUTBOX_DEFER_MS` without counting an attempt and goes on with other ops, so one held file
doesn't hold up the outbox. The property's later ops still wait behind it. SQLocal's transaction then takes its
own shared Web Lock while the file lock is held, an exception to ADR 0012's rule that nothing is
requested inside it; shared locks can't deadlock with each other.

**Other writers.** Sync ingest only adds attested rows, so a pending op that meets one applies the
conflict rule when it applies. For an edit already written as a draft, sync applies the rule after
it inserts property rows (`keepLocalDraftsOverSyncedRows`): readers take the newest row by
`COALESCE(attestation_created_at, created_at)`, so a draft older than the synced attestation gets
its `created_at` moved just past it and stays the value, and the conflict is recorded on an
`applied` op row of its own. A draft's `created_at` is still set to the time of its last edit;
that and this move are what make the local edit the newest row. Publish waits for a seed's pending ops to
apply before building its payload. `claimUnpublishedDrafts` stamps pending ops' publisher.
`removeLocalCopiesForAddresses` and purges delete the seed's ops. A property rename rewrites
pending ops that use the old name.

**Transactions.** `BaseDb.transaction(fn)` runs Drizzle queries atomically on both platforms: in
the browser through SQLocal's `transaction()` (Drizzle's own `db.transaction()` doesn't isolate
over the SQLocal driver), in Node through the libsql driver's `db.transaction()`. A transaction
that fails with `SQLITE_BUSY` is retried as a whole; the per-statement busy retry never runs
inside one. SQLocal is upgraded from 0.16 to 0.18 for `tx.batch` inside transactions and the
faster reactive bulk writes. From 0.17 SQLocal leaves cross-connection locking to SQLite, so
cross-tab contention surfaces as `SQLITE_BUSY`. In Node, libsql's own `transaction()` gives each
transaction a connection and opens another for what follows; several connections in one process
locked each other out and lost an op's insert in tests. So Node uses one connection with the
browser's semantics: one transaction at a time, and other statements wait for it
(`node/db/singleConnectionTransactions.ts`). The database runs in WAL mode for other processes.

## Consequences

An assigned value survives a reload, two tabs editing one draft produce one row, and a refused
save shows its error and the previous value by one path. `propertyWriteQueue`, its successor the
assignment-order tickets, `_valueBeforeSave`, the separate rollback paths,
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
