# Test Suite Performance

How the vitest suite was brought from ~26 minutes to ~4.5 minutes (October 2026), how to work with
the resulting setup, and the open findings that came up along the way.

## Results

Full `npx vitest run` (all three projects) on a 10-core / 64 GB Mac:

| Step | NodeJS | browser | browser-react | Full run |
|---|---|---|---|---|
| Before (sequential, `main` 2026-10-07) | 523s | 450s | 590s | ~26 min |
| Fixed sleeps → condition waits | 414s | 342s | 458s | ~20 min |
| Parallel workers | 108–130s | 129–147s | 160–226s | 5.3 min |
| Schema idle-wait fix | | | | 4.4 min |

Earlier runs that reported 45–50 minutes were on a broken tree: hung setup hooks each waited out a
90s `hookTimeout` (~8.5 min per run).

## How the suite is set up now

- **Parallel workers.** `vite.config.js` runs 4 NodeJS workers and 3 workers per browser project.
  Each browser worker gets its own Playwright browser context (separate OPFS and localStorage), and
  each Node file runs in its own forked process with its own temp project dir, so files on different
  workers don't share storage. Files on the *same* browser worker still run one after another against
  shared OPFS.
- **`TEST_WORKERS`** overrides the per-project worker count. `TEST_WORKERS=1 bun run test` restores
  one-file-at-a-time runs, which is what you want when chasing an order-dependent failure.
- **`sequence.groupOrder`** is required: vitest refuses to run projects with different `maxWorkers`
  in the same group. NodeJS is group 0; both browser projects are group 1 and run concurrently. A new
  vitest project needs a `groupOrder` too.
- **`DEBUG` is opt-in.** It used to be hard-coded to `'*'` (~400k log lines per NodeJS run). Use
  `DEBUG='seedSdk:*' bun run test` when you need it.
- **Setup hooks use `SETUP_HOOK_TIMEOUT_MS` (30s)** from `test-utils/client-init.ts` in both
  `packages/sdk/__tests__` and `packages/react/__tests__`, matching `hookTimeout` in `vite.config.js`.
  Healthy setup peaks around 9s; a hung setup now fails in 30s instead of 90–120s.
- **Workspace packages load from source.** `@seedprotocol/react`, `eas`, `arweave` and `query` are
  aliased to their `src` in every project (`workspaceSourceAliases` in `vite.config.js`). Their
  package exports point at gitignored `dist` builds, and before the aliases tests silently ran
  whatever was last built: a stale `packages/react/dist` hid 8 hook failures. A new workspace
  package the tests import needs an alias too. If Vite logs "optimized dependencies changed.
  reloading" in a browser run, every file in flight fails to import; add the named dependencies to
  that project's `optimizeDeps.include`. Those entries resolve from the repo root, and bun keeps
  package dependencies under `packages/*/node_modules`, so a dependency that isn't hoisted also needs
  a root `devDependencies` entry (as `js-yaml` and `parse5` have). Vite logs "Failed to resolve
  dependency: …, present in client 'optimizeDeps.include'" for entries it can't resolve.

## Writing tests that stay fast

- **Don't use fixed sleeps** (`await new Promise(r => setTimeout(r, N))`) to wait for something to
  happen. Wait for the condition instead:
  - `Item.create` resolves after its plain property values are written. To assert persistence, use
    `waitForItemPersisted(item, { title: '...' })` (`packages/react/__tests__/test-utils/persistence.ts`).
  - For "set a value, then assert", poll the assertion: `vi.waitFor(() => expect(...))` (SDK) or
    `waitFor` from Testing Library (React).
  - DB writes that follow an in-memory change (schema/model rename) are asynchronous — poll the DB
    assertion.
  - `ModelProperty` edits: `compareAndMarkDraft` awaits the DB write before the machine returns to
    idle, so waiting for idle is enough.
  - If the test tolerates the condition never arriving, use `waitUntil(cond, timeout)`
    (`packages/react/__tests__/test-utils/waitUntil.ts`, and a local copy in the SDK Schema/Model
    tests). It returns as soon as the condition holds.
- **Don't wait for a state with `service.subscribe()` alone.** XState's `subscribe` doesn't replay the
  current snapshot, so if the entity is already in that state the wait never fires and sits out its
  whole fallback timeout. This cost 5s per test in `model.test.tsx`. Check the current snapshot first
  (xstate `waitFor`, or `waitUntil(() => svc.getSnapshot().value === 'idle')`).
- **Don't drop readiness promises.** `Model.create` / `Schema.create` / `ModelProperty.create` without
  `waitForReady: false` return a promise that rejects if the entity isn't idle in time. If you don't
  await it, a slow run turns that into an unhandled rejection that fails the whole NodeJS run.
  - Html/File/Image values: `Item.create` and `ItemProperty.save()` resolve after the file and its
    metadata are written, so a reload right after them sees the value.
- Fixed sleeps are fine for: delays inside polling loops and windows that assert something does *not*
  happen (no extra callbacks/emissions).

## Open findings

Things noticed during this work. Line numbers are as of commit `627af7f` unless noted; fixed
findings keep their number so references to them stay valid.

### SDK behavior

1. **Fixed.** `Model.findUniqueModelName`'s schema-context check never ran (it called `getService()`
   on the promise `Schema.create` returns) and leaked a schema refCount. It was deleted; the cache
   check in the same function and `loadOrCreateModel` already handle duplicate names.
2. **`model.properties` can briefly return `[]`** after the model's liveQuery has reported property
   ids (`Model.ts:1738`). The getter only returns `ModelProperty` instances already in the static cache,
   which can lag `_liveQueryPropertyIds`. One test was changed to poll for this; callers in apps can
   see the same empty list. The ids are published only after instances are created, so likely
   causes are `ModelProperty.createById` returning a same-name instance cached under a different id
   (so `getById` keeps missing) and unordered async liveQuery emissions in `entityLiveQuery.ts`.
   `useItemProperties` reads `model.properties` and is affected.
3. **`Item.create` takes ~1s per item in the browser** (≈0.8–1.3s measured). It is now the main cost
   of per-test setup in the React suites (e.g. `item.test.tsx`'s `beforeEach` creates four items,
   ~3.8s per test). Most of it is ~5 sequential, uncached EAS GraphQL requests per item: one
   `GetSchemaByName` per property in `createMetadata`, plus the seed's schema UID lookup, which caches
   only found UIDs. The browser `QueryClient` helper builds a new client per call. Stubbing the
   requests took items from ~630ms to ~200ms. `waitForDb` and `waitForFile` also wait 100ms before
   their first check.
4. **Not a bug.** Html saves do have a completion signal (see "Writing tests that stay fast"); the 2s
   sleeps in `ItemProperty.test.ts` and `htmlPropertyPersistence.test.tsx` were removed.

### Test bugs and weak tests

5. **`item.test.tsx`'s cleanup never deletes its items.** `deleteTestSchemaItemsHooksRows`
   (`packages/react/__tests__/item.test.tsx:80`) selects seeds with
   `inArray(seeds.type, modelNames)` (line 114), but seed types are stored snake_cased (`'post'`,
   model name `'Post'`). Items accumulate across tests; the tests pass because they assert
   "at least N". Note: an attempt to import this file's schema once in `beforeAll` (and delete only
   item rows per test, with the type fixed) made per-test setup *slower* (3.8s → 4.1s), so creating
   items seems to get slower when models persist between tests — not investigated (live `Item` and
   `ItemProperty` instances each hold liveQueries that re-run on every insert, which is a guess).
   The same cleanup is copied into `SeedImage.test.tsx` and `modelProperty.test.tsx`. The SDK's
   `Item.test.ts` and `ItemProperty.test.ts` cleanups have the opposite bug: `seeds.type =
   models.name` never matches, so they delete every seed.
6. **A no-op test.** `packages/react/__tests__/modelProperty.test.tsx:796` ("…hook responds to
   database changes via liveQuery") creates a model and asserts nothing about the hook afterwards.
7. **Lenient tests.** Several tests accept the condition they test never happening, e.g.
   `liveQueryTiming.test.tsx:481` only logs a warning if the reactive query misses the update, and
   some Schema/Model tests note "models may not be loaded yet" and assert only `Array.isArray`.

### Failing on `main` (not caused by this work)

8. **Order-dependent `Item/unpublish.integration.test.ts` failures** ("Item is read-only: you do not
   own this item") when certain files (e.g. `Item/getItems.test.ts`) run before it on the same
   browser worker. Being fixed in a separate session as of 2026-10-07.
9. **Fixed** by `35d322b` (it now uses `vi.mock` instead of `vi.spyOn` on module namespaces).
10. **Fixed** by `35d322b` (removed the test's `@/node/db/Db` import).
11. **Fixed.** The tests ran a stale `packages/react/dist`; see "Workspace packages load from source".
12. Flaky in `modelProperty.test.tsx`: `useModelProperties > should return properties when …`
    (30s timeout) and three `useModelProperty` tests (~17s), intermittently. Not reproduced since the
    source aliases landed. Possible causes from reading the code: `useModelProperties` memoizes
    `_dbId` on `[model]`, so it can stay undefined and leave only the 400/1200/2500ms refetches; and
    `useModelProperty`'s schemaId lookup runs once and never retries if `getPropertySchema` comes back
    empty (which it can, via finding 2).
13. **Fixed.** A stale `packages/eas/dist`; see "Workspace packages load from source".
