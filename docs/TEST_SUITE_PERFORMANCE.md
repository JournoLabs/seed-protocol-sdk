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
- Fixed sleeps are fine for: delays inside polling loops, windows that assert something does *not*
  happen (no extra callbacks/emissions), and Html property saves (see open findings).

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
rejects with the loading stage. See open finding 14 for the other files with this pattern.

## Open findings

Things noticed during this work and not fixed. Line numbers are as of commit `627af7f`.

### SDK behavior

1. **`Model.create`'s schema duplicate-name check is dead code and leaks a promise.**
   `packages/sdk/src/Model/Model.ts:260` calls `SchemaClass.create(schemaName)` without
   `waitForReady: false`, which returns a `Promise<Schema>`. The next line calls
   `schema.getService()` on the promise, throws, and the surrounding `try` swallows it — so models are
   never checked against the schema context's model names. The dropped promise can also reject
   unhandled if the schema isn't idle within 15s. Fixing it changes behavior (the check would start
   renaming models), so it needs a decision, not just a one-line change.
2. **`model.properties` can briefly return `[]`** after the model's liveQuery has reported property
   ids (`Model.ts:1738`). The getter only returns `ModelProperty` instances already in the static cache,
   which can lag `_liveQueryPropertyIds`. One test was changed to poll for this; callers in apps can
   see the same empty list.
3. **`Item.create` takes ~1s per item in the browser** (≈0.8–1.3s measured). It is now the main cost
   of per-test setup in the React suites (e.g. `item.test.tsx`'s `beforeEach` creates four items,
   ~3.8s per test).
4. **Html property saves have no completion signal.** The value goes through an async save pipeline
   after the property reports idle, so tests still sleep 2s before reloading:
   `packages/sdk/__tests__/ItemProperty/ItemProperty.test.ts:2021` and
   `packages/react/__tests__/htmlPropertyPersistence.test.tsx:240`.

### Test bugs and weak tests

5. **`item.test.tsx`'s cleanup never deletes its items.** `deleteTestSchemaItemsHooksRows`
   (`packages/react/__tests__/item.test.tsx:80`) selects seeds with
   `inArray(seeds.type, modelNames)` (line 114), but seed types are stored snake_cased (`'post'`,
   model name `'Post'`). Items accumulate across tests; the tests pass because they assert
   "at least N". Note: an attempt to import this file's schema once in `beforeAll` (and delete only
   item rows per test, with the type fixed) made per-test setup *slower* (3.8s → 4.1s), so creating
   items seems to get slower when models persist between tests — not investigated.
6. **A no-op test.** `packages/react/__tests__/modelProperty.test.tsx:796` ("…hook responds to
   database changes via liveQuery") creates a model and asserts nothing about the hook afterwards.
7. **Lenient tests.** Several tests accept the condition they test never happening, e.g.
   `liveQueryTiming.test.tsx:481` only logs a warning if the reactive query misses the update, and
   some Schema/Model tests note "models may not be loaded yet" and assert only `Array.isArray`.

### Failing on `main` (not caused by this work)

8. **Order-dependent `Item/unpublish.integration.test.ts` failures** ("Item is read-only: you do not
   own this item") when certain files (e.g. `Item/getItems.test.ts`) run before it on the same
   browser worker. Being fixed in a separate session as of 2026-10-07.
9. `events/item/easSyncManager.test.ts` — "merges requests received while a sync is in flight into the
   next run" (browser).
10. `Schema/stagedLoading.test.ts` fails to load in the browser project; the load error points at
    `packages/sdk/src/node/db/Db.ts` (a Node-only module).
11. React create/destroy hooks: 8 tests across `item`, `itemProperty`, `model`, `modelProperty` and
    `schema` `.test.tsx` (`useDeleteItem`, `useDestroy*`).
12. Flaky in `modelProperty.test.tsx`: `useModelProperties > should return properties when …`
    (30s timeout) and three `useModelProperty` tests (~17s), intermittently.
13. `helpers/easPropertyCanonical.test.ts` — 3 "revoked attestations" tests, in both projects. The fix
    they cover (`b8b9559`) is in `packages/eas/src`, and the SDK re-exports it from the built package,
    so a stale `packages/eas/dist` is the likely cause (unverified).
14. **Many test files throw inside a `waitFor` predicate** (`throw new Error('… failed to load')` when
    the snapshot is `error`). As described in the large-schema section above, the throw escapes as an
    uncaught exception on every later snapshot instead of failing the wait. Fixed in
    `validation-timeout.test.ts` only; still present in `Schema/Schema.test.ts`, `Model/Model.test.ts`,
    `Schema/schema-models-integration.test.ts`, `Item/Item.test.ts`, `Item/getItems.test.ts`,
    `ItemProperty/*.test.ts`, `ModelProperty/ModelProperty.test.ts`,
    `helpers/updateSchema-propertyRenameMetadata.test.ts`, `test-utils/getPublishPayloadIntegrationHelpers.ts`,
    and several `packages/react/__tests__` files. A shared helper would fix them all.
15. **`ModelProperty.getById` scans the whole instance cache** (~0.9s of a 1000-model import, since
    `Model._refreshPropertiesFromDb` calls it per property). An id index would have to follow id
    changes: a property is often created with a generated id and then gets its real one.
