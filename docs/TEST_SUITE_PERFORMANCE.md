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
  `packages/sdk/__tests__` and `packages/react/__tests__`, matching `hookTimeout` in `vite.config.js`
  (all three projects; the NodeJS project used vitest's 10s default until 2026-10-07).
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
- **Scope model lookups to the test's schema.** Model names are only unique per schema, and many test
  files reuse names (`Post`, `TestPost`, `Article`, `Author`, `Tag`, `TestModel`). A bare name can
  resolve another file's model on the same worker or throw `AmbiguousModelError`, depending on file
  order. Pass `schemaName` (or `modelFileId`) to `Item.create`, `Item.all`, `createItem`,
  `Model.getByName`, `getPropertySchema`, `ModelProperty.create`, and join raw `models` queries
  through `model_schemas`. Note that the `models` table has no schema column: `dbModel.schemaName`
  on a `models` row is always `undefined`.
- **React tests are unmounted for you.** `packages/react/__tests__/setup.browser.ts` calls Testing
  Library's `cleanup()` after each test. Vitest runs without `globals`, so Testing Library doesn't
  register it itself; before that was added, every tree a test rendered stayed mounted for the rest
  of the file (clearing `document.body` only detaches containers), and its hooks kept refetching
  while the next `beforeEach` deleted and re-imported the schema.
- In browser tests the page's `console.log` isn't printed; use `console.warn` for probes.
- Fixed sleeps are fine for: delays inside polling loops and windows that assert something does *not*
  happen (no extra callbacks/emissions). Html/File/Image values don't need one: `Item.create` and
  `ItemProperty.save()` resolve after the file and its metadata are written, so a reload right after
  them sees the value.

## Large schema imports (`validation-timeout.test.ts`)

`validation-timeout.test.ts` imports schemas with 1000 models, 500 models, and one model with 1000
properties. On 2026-10-07 it failed 1–3 of its 17 tests per run: those tests timed out, and the
`beforeEach` cleanup after the 1000-model test hit the 10s hook timeout. Nothing merged that day
caused it. The cause was SDK import cost, made worse by machine load (parallel workers, other
sessions):

- **Quadratic id hashing.** `importJsonSchema` derived each missing property id by hashing the whole
  serialized schema plus the property name: ~100KB hashed 2000 times, ~6.6s. It now hashes the schema
  once (`getDeterministicIdsWithPrefix`); the ids don't change.
- **Every `ModelProperty` parsed every schema file.** Its schema-name lookup read `this.modelId`, a
  field that is never assigned, so the DB lookup never ran. Every property fell back to
  `getSchemaNameFromModel`, which reads and JSON-parses every schema file in the working dir. This
  ran 2000 times after the import returned and blocked the event loop for ~10s. That stall is what
  pushed the next test's cleanup past its timeout. Fixing it exposed a bug the slow lookup had hidden:
  `initializeOriginalValues` was clearing `_schemaName`.

The 1000-model test went from 22–33s to 7–10s, and the 500-model test from 23–50s to 4–8s. Cleanup
after them now takes <0.1s instead of 0.5–2s+. Under extreme load (load average ~130 on 10 cores) the
heavy tests can still time out, since each import still runs ~20k SQLite queries.

The file's `waitForSchemaIdle` also threw inside xstate `waitFor`'s predicate. `waitFor` doesn't
catch that, so a schema in its `error` state raised an uncaught exception on every later snapshot
(1001 in one run), and the wait itself timed out. The helper now waits for `idle` or `error` and then
rejects with the loading stage. See open finding 17 for the other files with this pattern.

## Open findings

Things noticed during this work. Line numbers are as of commit `627af7f`, except findings 14–16
and the updates to 5 and 12, which are as of `ee8cec6`, and 17–18 (`c3cdcfd`). Fixed findings keep
their number so references to them stay valid.

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
   The same snake_case/PascalCase mismatch is in `modelProperty.test.tsx:80` and
   `SeedImage.test.tsx:148`, and in the SDK `Item.test.ts:156` / `ItemProperty.test.ts:166` cleanup
   subqueries (`seeds.type = models.name`), which therefore never match. Where the type *is* written
   snake_cased (e.g. `itemProperty.test.tsx`, `htmlPropertyPersistence.test.tsx`), the cleanup
   deletes every schema's seeds of that type, not just this file's.
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
    (30s timeout) and three `useModelProperty` tests (~17s), intermittently. **Likely fixed by
    `22c3a7e`, not proven.** It didn't reproduce on `main` in 9 full browser-react runs (parallel,
    `TEST_WORKERS=1`, and concurrent with the browser project) or 12 runs of the file alone. What
    those runs did show, in 12 of 13 file runs, was a stale write for the file's deleted Post model
    (`Write error for model "post-model-id": Model with id 34 does not exist`), from earlier tests'
    still-mounted hooks racing the next `beforeEach`. With `cleanup()` in the setup file that write
    is gone and the project's summed test time dropped from ~430–480s to ~340–370s. Reopen this if
    the failure comes back. Another possible cause, from reading the code: `useModelProperty`'s
    schemaId lookup runs once and never retries if `getPropertySchema` comes back empty (which it can,
    via finding 2). See also finding 15.
13. **Fixed.** A stale `packages/eas/dist`; see "Workspace packages load from source".
14. **Stale model writes in `react/__tests__/model.test.tsx`** (5 per run, identical before and after
    `22c3a7e`): `[writing] Write error for model "post-model-models-test-id" / "article-model-models-test-id":
    Model with id N does not exist`. These are writes started by the schema import that are still
    running when the next test's `beforeEach` deletes the rows. `4863469` added
    `waitForInFlightWrites()` and calls it from `Schema.destroy` and the SDK's `cleanupTestSchemaData`,
    but the React test files delete rows with their own helpers, and `waitForInFlightWrites` isn't
    exported from `@seedprotocol/sdk`, so they can't drain them yet. The tests pass.
15. **`useModelProperties` can miss properties written late** (`packages/react/src/modelProperty.ts:58`).
    `dbModelId` is memoized on `[model]` from `model._getSnapshotContext()._dbId`. If `_dbId` isn't set
    when the model is first seen, the memo never updates (same object), so the live query on the
    `properties` table is never built and only the fixed refetches at 0.4/1.2/2.5s (line 107) can pick
    up properties. Under load, properties written after 2.5s would leave the list empty. Not observed
    failing; found while instrumenting finding 12.
16. **Name-only item listing (test side only).** `getItemsData({ modelName })`, `Item.all(name)` and
    `useItems({ modelName })` without `schemaName` / `modelFileId` filter by `seeds.type`, so they
    return items from every schema with that model name. **That's working as designed** (2026-10-07):
    model types are global and a schema is a local lens over seeds, so an unscoped list spans schemas.
    What's left is in the tests: `Item/getItems.test.ts` and react `item.test.tsx` call these unscoped
    and only pass because they find their items by id. `getItems.test.ts` also inserts a raw seed with
    no `model_file_id`, so scoping it needs that fixture changed.
17. **Many test files throw inside a `waitFor` predicate** (`throw new Error('… failed to load')` when
    the snapshot is `error`). As described in the large-schema section above, the throw escapes as an
    uncaught exception on every later snapshot instead of failing the wait. Fixed in
    `validation-timeout.test.ts` only; still present in `Schema/Schema.test.ts`, `Model/Model.test.ts`,
    `Schema/schema-models-integration.test.ts`, `Item/Item.test.ts`, `Item/getItems.test.ts`,
    `ItemProperty/*.test.ts`, `ModelProperty/ModelProperty.test.ts`,
    `helpers/updateSchema-propertyRenameMetadata.test.ts`, `test-utils/getPublishPayloadIntegrationHelpers.ts`,
    and several `packages/react/__tests__` files. A shared helper would fix them all.
18. **`ModelProperty.getById` scans the whole instance cache** (~0.9s of a 1000-model import, since
    `Model._refreshPropertiesFromDb` calls it per property). An id index would have to follow id
    changes: a property is often created with a generated id and then gets its real one.

### Plan

Agreed order for the remaining findings (2026-10-07). Findings 1, 4, 9–11 and 13 are fixed on branch
`fix/test-source-aliases`, not yet merged as of this writing.

- **Step 3 — test cleanup and weak tests: 5, 6, 7, 14, 16.** A shared seed-cleanup helper that deletes
  by `modelFileId` instead of `seeds.type`, used by every file listed under 5. The React files switch
  to the SDK's `cleanupTestSchemaData()`, which drains in-flight writes (14), instead of their own
  delete helpers. Scope the remaining unscoped item listings in tests (16). Exact counts in place of
  "at least N", a real assertion for the no-op test, and `waitUntil` failing instead of returning
  false where a test needs the condition. Starts after the finding-17 branch
  (`claude/nifty-heyrovsky-08dd27`) merges, since both touch the same test files.
- **Step 4 — finding 3.** Cache EAS schema lookups, including misses (~630 → ~200ms per item).
- **Step 5 — hooks and caches: 2, 12, 15.** `ModelProperty` cache identity behind `model.properties`.
  In `useModelProperties`, read `_dbId` from the model's live snapshot (or resolve by `modelFileId`)
  instead of memoizing it once, with a test that delays the property write past the 2.5s refetches.
  Recheck 12 after that.
- **Not scheduled:** 8 (separate session), 17 (in progress on `claude/nifty-heyrovsky-08dd27`), 18.
