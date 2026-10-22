# 0014. Entity state lives in actor context behind reactive proxies; caches are keyed by stable id

- **Status:** Accepted
- **Date:** 2026-10-18 (records the design in place since 2025; written as a baseline for the entity refactor)
- **Scope:** `@seedprotocol/sdk` (`Schema`, `Model`, `ModelProperty`, `Item`, `ItemProperty`, `helpers/reactiveProxy.ts`)

## Context

Entities are edited with plain assignment (`schema.name = 'x'`, `item.title = 'x'`) and read
back at once, and React has to re-render when they change. Property names on Items are defined at
runtime by schemas. Each entity runs an xstate actor that loads it from the database and runs its
background work. Before this design, `Schema` and `ModelProperty` defined a getter and setter per
field with `Object.defineProperty`, and Models were cached by `schemaName:modelName`, so a rename
invalidated the cache entry.

## Decision

**Reactive proxies.** `create()` returns a `Proxy` around the instance. Reads of tracked fields
come from the actor's context; writes send `updateContext` to the actor, and React hooks subscribe
to the actor. Methods and untracked members pass through to the instance. `ownKeys` returns only
the target's own keys, and `getOwnPropertyDescriptor` goes through
`getInvariantSafePropertyDescriptor`, so the proxy never violates invariants on frozen or
non-extensible targets. The shared factory is `createReactiveProxy`.

**One writer at a time.** At load, the database fills the actor context. After that the context is
the source of truth and changes flow from it to the database.

**Optimistic conflict detection** (Schema, Model, ModelProperty). The row's update time at load
(`_dbUpdatedAt`) is compared before each write; a newer row raises `ConflictError`, and the caller
can `reload()`.

**Id-keyed caches.** The primary cache key is the entity's schema-file id, which never changes. The
name is a secondary index (name to id), so a rename moves one index entry and leaves the instance
in place.

**Per-process tables, not a generic services table.** Long-running work persists in its own
tables (`publish_processes`, `upload_processes`, `eas_sync_processes`, `arweave_l1_finalize_jobs`)
rather than one `services` table holding every actor's state.

## Consequences

Assignment updates in memory at once and React follows, with no per-field accessors on the
classes. Renames don't churn caches.

Known costs, recorded so the entity refactor can address them:
- Item doesn't use `createReactiveProxy`: it has two hand-written proxy handlers and defines one
  accessor per model property on the raw instance. Model has its own handler.
- Per-instance state is stored in WeakMaps keyed by the raw instance, while prototype methods run
  with `this` set to the proxy, so `unload` and `destroy` miss the state and liveQuery
  subscriptions stay open.
- Several lookups take cache holds that are never released.
- `Item` and `ItemProperty` have no conflict detection; their writes rely on per-property ordering
  and row timestamps.

A later ADR on the outbox and entity identity is expected to supersede parts of this one.

## Amendment (2026-10-22, audit T1)

The five classes now share one implementation of what this ADR left to each class
(`helpers/entity/entityCache.ts`, `entityLifecycle.ts`):

- **One cache entry per instance.** `EntityCache` stores an instance once under all its keys, its
  id first, and finds it by key or by actor. The entry owns its keys, so a rename replaces them and
  removal deletes stale aliases too. `peek` takes no hold; `hold`, `add({ hold: true })` and
  `holdInstance` take one; `release` gives one back.
- **Child holds.** A Schema holds its Models, a Model its ModelProperties, an Item its
  ItemProperties, released when the parent is torn down.
- **One teardown.** Unload, destroy and evict run the same teardown: leave the cache, release
  child holds, run disposers (watches, object URLs), stop the actor.
- **Load status instead of load states.** Each entity's load is an awaited function; `status` is
  `loading`, `ready` or `error`, mirrored into the actor context as `_status` so actor subscribers
  see it. Machines keep context and process states (validating, publishing, saving to schema).

## Alternatives considered

- **`Object.defineProperty` per field** (the earlier design): needs every field known up front,
  which doesn't work for Items.
- **One `services` table for all actor state** (planned alongside the id caches, never built):
  per-process tables let each process keep its own columns, guards and resume logic.
