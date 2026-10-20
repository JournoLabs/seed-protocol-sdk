# 0015. Database reactivity goes through `BaseDb.liveQuery`

- **Status:** Accepted; amended by [0020](0020-entity-reactivity-through-a-change-log.md) for Item and ItemProperty
- **Date:** 2026-10-18 (records the design in place since 2025)
- **Scope:** `@seedprotocol/sdk` (`db/Db/BaseDb.ts`, `browser/db/Db.ts`, `node/db/Db.ts`, entity live queries, React hooks)

## Context

Entities and hooks need to know when rows they show change, including rows written by sync,
publish, or another tab. Re-reading on a timer in every consumer would be slow and inconsistent.
In the browser, SQLocal can re-run a query when a table it reads changes, if the client is created
with `reactive: true`.

## Decision

`BaseDb.liveQuery<T>(query)` returns an RxJS `Observable<T[]>` that emits the query's rows and
emits again when they change. It accepts an SQL tag function (`(sql) => sql\`...\``) or a Drizzle
query builder.

- **Browser:** wraps SQLocal's `reactiveQuery` on the `SQLocalDrizzle` instance created with
  `reactive: true`. SQLocal re-runs the query when a table it reads changes, including writes from
  other tabs' SQLocal instances (see ADR 0012). Emissions pass through `distinctUntilChanged` on a
  JSON snapshot, because SQLocal can reuse and mutate the same result array.
- **Node:** a polling stub. It re-runs a Drizzle query builder every second and emits when the JSON
  of the result changes. SQL tag functions throw.

Consumers own their subscriptions and must unsubscribe when the entity or component goes away.

Since ADR 0020, loaded Items and ItemProperties don't hold liveQueries on `seeds`, `versions` and
`metadata`: they register with the tab's change feed (`browser/db/changeFeed.ts`) and re-read when
a write touched their seed. Everything else still uses `BaseDb.liveQuery`.

## Consequences

One API covers both platforms, and cross-tab changes reach the browser without extra messaging.

- Node reactivity is approximate (up to a second late) and doesn't support tag functions, so
  code that must run in Node uses query builders. Item's and ItemProperty's change-feed watches
  run only in the browser.
- SQLocal doesn't fire for a `DELETE` without a `WHERE` clause (its truncate optimization), and
  writes inside a transaction fire only on commit. The change log's triggers turn the optimization
  off for `seeds`, `versions` and `metadata` (ADR 0020).
- Subscriptions are long-lived, so teardown bugs leak queries. Item, ItemProperty, Schema and Model
  currently store their subscriptions where `unload` and `destroy` can't find them (see ADR 0014's
  consequences).

## Alternatives considered

- **Polling in each consumer.** Slower, and each consumer would re-implement change detection.
- **Event-bus notifications from every writer.** Misses writes from other tabs and from code that
  writes tables directly, such as sync.
