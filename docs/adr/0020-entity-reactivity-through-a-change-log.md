# 0020. Loaded entities learn about row changes from one trigger-fed change log

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@seedprotocol/sdk` (`browser/db`, migrations, Item, ItemProperty), `@seedprotocol/react`
  (indirectly); amends ADR 0015 for Item and ItemProperty

## Context

Each loaded Item holds a `seeds` and a `versions` liveQuery, and each ItemProperty a `metadata`
liveQuery (`Item._setupLiveQuerySubscription`, `ItemProperty._setupLiveQuerySubscription`, ADR
0015). SQLocal 0.18 learns which tables a statement wrote from SQLite's update hook, debounces them
32 ms (180 ms at most), and broadcasts the table names on `_sqlocal_effects_(<db>)`. Every reactive
query that reads one of those tables, in every tab, re-runs its SQL as its own worker message. The
broadcast carries no row ids, so a write to one seed re-runs the queries of every loaded seed.

With N items of P metadata rows loaded, a create writes all three tables and starts (2 + P) × N
re-runs; a property save writes `metadata` and starts P × N. A spike on 2026-10-19 counted SQLocal
`sql()` calls in the 600 ms after a write (items of 9 rows): 110 and 90 at 10 items, 220 and 180 at
20. The bench (`__tests__/bench/itemLatency.test.ts`, 40 items of 8 properties) counted 400 runs
per create. All statements share one worker, so a find or load issued during the wave waits behind
it: an uncached `Item.find` took 677 ms after a create and 157 ms once the queue had drained.

## Decision

**A change-log table written by SQLite triggers.** Migration 0023 adds `entity_changes` (`seq`
integer primary key autoincrement, `tbl`, `seed_local_id`, `seed_uid`, `property_name`, `at`) and
`AFTER INSERT`, `AFTER UPDATE` and `AFTER DELETE` triggers on `seeds`, `versions` and `metadata`.
Each trigger inserts one row with the written row's keys (`NEW` for inserts and updates, `OLD` for
deletes). An update that changes `seed_local_id`, `seed_uid` or `property_name` inserts a second
row with the `OLD` keys, so watchers of the old key hear about it too. The log row commits or rolls
back with the write that caused it.

Triggers, rather than `updated_at` or calls in each writer, because about twenty write paths don't
set `updated_at` (every insert by `createSeed`, `createVersion` and EAS sync's inserts, the
`seedUid` cascade in `updateSeedUid`, renames, soft deletes, init fixups, SQL migrations), hard
deletes leave no row to compare, and most writers bypass the outbox. A trigger covers all of them
and every writer added later.

**One feed per tab.** `BrowserDb` keeps a single reactive query, `SELECT max(seq) FROM
entity_changes`, and a cursor. When it emits a higher `seq`, the feed reads `WHERE seq > cursor`,
advances the cursor and calls the listeners registered for each changed row's seed, keyed by
`seed_local_id` and by lowercased `seed_uid`, and for metadata rows by `property_name`. A listener
called several times in one read runs once. The feed starts at the last seq SQLite allocated
(`sqlite_sequence`, which survives pruning).

**Entities re-read on dispatch instead of holding a liveQuery.** An Item registers for its seed's
`seeds` and `versions` changes and, when called, runs the same seeds and versions queries once and
feeds the rows to today's handlers. An ItemProperty registers for its seed and its 1–3 metadata
property names and runs its metadata query once. The handlers stay as they are, including the
`hasPendingPropertyWrite` skip and the superseded-uid check, and a newer read discards an older
one's result, as SQLocal's `updateOrder` did. Each read also runs once when the entity registers,
as a liveQuery's first emission did, and a read that returns the rows already handed over doesn't
reach the handler, as `BaseDb.liveQuery`'s `distinctUntilChanged` did.

**Pruning.** The leader tab deletes log rows older than 10 minutes, at most once a minute. A tab
whose cursor is older than the oldest remaining row (it was suspended) calls every listener once.
Deleting log rows fires the feed but doesn't raise `max(seq)`, so nothing is dispatched.

**Other tabs.** Nothing new is sent between tabs. A write in one tab inserts log rows, SQLocal's
effects broadcast reaches every tab, and each tab's feed reads the new rows. This works without a
leader and with `multiTab: 'off'`.

`BaseDb.liveQuery` stays for the rest: Schema, Model and ItemProperty's property-definition
queries, the React list hooks, and app code. Node has no entity reactivity today and gets none.

## Consequences

Per write, each tab runs the feed query, one cursor read and one read for each loaded entity whose
seed the write touched, instead of (2 + P) × N re-runs. A create of an item that isn't loaded runs
2 statements; a save of a loaded property runs 3. The bench (`bench/itemLatency.test.ts`, 40 items
of 8 properties) measured that, against 400 and 320 before; an uncached `Item.find` right after a
create went from 563 ms to 114 ms, the same as with a drained queue, and item loads no longer grow
with the number loaded (245 ms for items 1–20 and 240 ms for 21–40, against 362 and 608). The spike measured the cursor read at 1.1–1.3 ms
after the first and one feed emission per write, including writes made outside the outbox.

- Every write to the three tables writes one more row per written row (11 for a create of a 9-row
  item). Measured with one item loaded (`bench/entityChangesWriteCost.test.ts`, medians of 40),
  the triggers add 1.4 ms to a `createNewItem` (43.9 to 45.3 ms) and 3 ms to a `property.save`
  (43.0 to 46.1 ms).
- Migrations and init fixups that rewrite many rows fill the log. They run before entities load,
  so the feed starts past them; the rows are pruned on schedule.
- An unconditional `DELETE` (as in `resetAmbiguousLegacyItemData`) fires a trigger per row, since
  SQLite doesn't use its truncate optimization on a table with triggers. This also removes the
  "DELETE without WHERE doesn't fire" gap in ADR 0015 for these tables.
- A trigger must be kept in step with the table: a migration that rebuilds `seeds`, `versions` or
  `metadata` must recreate its triggers.
- Readers of the tables don't change. `useItems` and `useItemProperties` keep their own
  liveQueries, one per mounted hook, so a page that mounts `useItemProperties` per row stays
  O(rows) until those hooks move to the feed too.

## Alternatives considered

- **One reactive query per table returning `(seed_local_id, max(updated_at))`, diffed in JS.** Same
  dispatch, but `updated_at` is missing on about twenty write paths, deletes can't be seen, and the
  `GROUP BY` scans the whole table on every write in every tab.
- **The outbox drainer, EAS sync and publish broadcast the seed ids they touched.** Fewest
  statements per write, but every writer outside the outbox (sync, publish receipts, revocation,
  `claimUnpublishedDrafts`, hard deletes, renames, `updateMetadata` during loads, init fixups) must
  remember to call it; ADR 0015 rejected this for the same reason. The tab channel exists only with
  `multiTab: 'coordinate'`, and a tab that closes between commit and broadcast loses the message.
- **One metadata liveQuery per Item instead of one per ItemProperty.** 3 × N re-runs per create and
  N per save (120 and 40 at 40 items): smaller, still O(loaded items), and each re-run returns all
  of the item's rows.
