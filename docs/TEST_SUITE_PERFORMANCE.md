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
    (`packages/react/__tests__/test-utils/waitUntil.ts`, `packages/sdk/__tests__/test-utils/waitUntil.ts`).
    It returns `false` on timeout. If the test needs the condition, use
    `waitUntilOrThrow(cond, description, timeout)` from the same files, so a timeout fails the test
    instead of being ignored (finding 7).
- **Don't wait for a state with `service.subscribe()` alone.** XState's `subscribe` doesn't replay the
  current snapshot, so if the entity is already in that state the wait never fires and sits out its
  whole fallback timeout. This cost 5s per test in `model.test.tsx`. Check the current snapshot first
  (xstate `waitFor`, or `waitUntil(() => svc.getSnapshot().value === 'idle')`).
- **Wait for an entity's idle state with `test-utils/waitForIdle.ts`** (`waitForSchemaIdle`,
  `waitForModelIdle`, `waitForItemIdle`, `waitForItemPropertyIdle`, `waitForModelPropertyIdle`;
  React tests import it from `../../sdk/__tests__/test-utils/waitForIdle`). Don't throw inside an
  xstate `waitFor` predicate: `waitFor` doesn't catch it, so the throw escapes as an uncaught
  exception on every later snapshot and the wait only fails on its timeout. Wait for `idle` or
  `error`, then reject after the wait, as the helper does.
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
- **Clean up with `cleanupTestSchemaData({ items: true })`** (`packages/sdk/__tests__/test-utils/cleanupTestDb.ts`;
  React tests import it from `../../sdk/__tests__/test-utils/cleanupTestDb`). It evicts the test
  schemas' cached models, waits for writes already running, deletes every test schema with its models,
  properties and (with `items`) items by `model_file_id`, and deletes the schema files. Don't write
  per-file delete helpers: the old ones matched items by `seeds.type` (which missed them, or deleted
  other schemas' items) and several left models behind as orphans.
  If every test needs the same schema, import it once in `beforeAll` and call `cleanupTestItems()`
  per test (items only): evicting and re-importing per test makes the next import ~2s and each
  `Item.create` ~0.4s slower, because the models are rebuilt cold. Old helpers that skipped eviction
  looked faster only because they reused Model instances bound to rows they had just deleted.
- **React tests are unmounted for you.** `packages/react/__tests__/setup.browser.ts` calls Testing
  Library's `cleanup()` after each test. Vitest runs without `globals`, so Testing Library doesn't
  register it itself; before that was added, every tree a test rendered stayed mounted for the rest
  of the file (clearing `document.body` only detaches containers), and its hooks kept refetching
  while the next `beforeEach` deleted and re-imported the schema.
- In browser tests the page's `console.log` isn't printed; use `console.warn` for probes.
- **EAS schema lookups are cached per page / process**, including misses (finding 3). A test that
  stubs the EAS client and needs a fresh lookup should call `resetSchemaUidCaches()` from
  `@seedprotocol/eas` first (as `schemaUidCache.test.ts` does).
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
rejects with the loading stage. It became the shared `test-utils/waitForIdle.ts` (finding 17).

## Open findings

Things noticed during this work. Line numbers are as of commit `627af7f`, except findings 14–16
and the updates to 5 and 12, which are as of `ee8cec6`, 17–18 (`c3cdcfd`), and the step 3 updates
to 5–7, 14 and 16 (branch `claude/step3-test-cleanup`). Fixed findings keep
their number so references to them stay valid.

### SDK behavior

1. **Fixed.** `Model.findUniqueModelName`'s schema-context check never ran (it called `getService()`
   on the promise `Schema.create` returns) and leaked a schema refCount. It was deleted; the cache
   check in the same function and `loadOrCreateModel` already handle duplicate names.
2. **Fixed** (step 5, branch `claude/step5-hooks-caches`). `model.properties` returned `[]` while the
   model's liveQuery had no property ids, and in one case for good: after a schema is re-imported,
   `Model.find` returns a Model that loaded from the schema file before the import wrote its
   `models` row (`loadOrCreateModel` step 2 reports success without `_dbId`). `setupEntityLiveQuery`
   only retried the row lookup on snapshot changes, and an idle model has none, so `_dbId` and the
   properties liveQuery were never set up (reproduced in 2 of 3 re-imports per run). It now also
   retries on a backoff timer (~60s, until found or the actor stops), which covers Schema too. The
   timer only acts while the entity is idle and, for a Model, while its `writeProcess` isn't
   writing: a model writes from that child while itself idle, and finding its row mid-write gave it
   a `_dbId` before its properties' rows existed (`ModelProperty.test.ts` "writes a runtime model
   property once" then failed every run).
   Tests: `Model/modelPropertiesAfterReimport.test.ts`, `helpers/entityLiveQuery.test.ts`.
   The other suspected cause, `ModelProperty.createById` returning a same-name instance cached
   under a different id, didn't show up in a probe of imports, runtime models and re-imports.
3. **Fixed** (step 4, branch `fix/eas-schema-lookup-cache`). `Item.create` took ~1s per item in the
   browser. Each item made 4–5 sequential, uncached EAS GraphQL requests (~80ms each): one
   `GetSchemaByName` per property in `createMetadata` and one `GetSchemas` for the model in
   `getEasSchemaUidForModel`, whose misses (most test models, e.g. `Article`) were re-requested every
   time. `item.test.tsx` made 289 EAS requests per run. These lookups now go through a cache in
   `packages/eas/src/stores/schemaUidCache.ts` that keeps found UIDs and misses (misses for
   `SCHEMA_LOOKUP_MISS_TTL_MS`, 5 min, so a schema registered by another client is found
   eventually), shares in-flight requests, and drops every cached miss when this client registers a
   schema (`setSchemaUidForSchemaDefinition` / `setSchemaUidForModel`, which publish's
   `ensureEasSchemasForItem` calls). `getEasSchemaUidForSchemaDefinition` caches its misses the
   same way, and `updateMetadata` uses the same lookup as `createMetadata`. Request failures are
   not cached. Tests: `packages/sdk/__tests__/helpers/schemaUidCache.test.ts`.
   The Item machine's `waitForDb` and the browser `waitForFileWithContent` (called by every
   `saveFile`) now check once before polling instead of waiting 100ms first.
   Measured back to back against `main` on a loaded machine: `item.test.tsx` per-item `Item.create`
   825/1157ms → 415/730ms (two rounds), its EAS requests 289 → 7, and browser-react summed file
   time 267/334/272s → 174/238/179s (three rounds, same 205 passing); browser 294s → 229s (one
   round). Full runs on the branch: browser twice (once with `--sequence.shuffle.files`), NodeJS
   once, no failures. On a quieter run, items after
   the first per model took ~125–230ms.
   Not changed: the browser `QueryClient` helper still builds a new client per call. Building one
   is cheap, and with `staleTime` 0 sharing one would not cache anything; it would dedupe
   concurrent requests by query key, and several keys omit their variables
   (`getPropertySchema${name}` is shared by model and property lookups and ignores the data type).
   Sharing a client needs those keys fixed first. Each per-call client also schedules a 24h
   `gcTime` timer per query, which keeps the result alive for a day in long-running apps.
4. **Not a bug.** Html saves do have a completion signal (see "Writing tests that stay fast"); the 2s
   sleeps in `ItemProperty.test.ts` and `htmlPropertyPersistence.test.tsx` were removed.

### Test bugs and weak tests

5. **Fixed** (step 3). `item.test.tsx`'s cleanup never deleted its items: it selected seeds with
   `inArray(seeds.type, modelNames)`, but seed types are snake_case (`'post'`) and model names aren't
   (`'Post'`). The same mismatch was in `modelProperty.test.tsx` and `SeedImage.test.tsx`, and in the
   SDK `Item.test.ts` / `ItemProperty.test.ts` subqueries (`seeds.type = models.name`), which never
   matched and so deleted every item. `itemProperty.test.tsx` and `htmlPropertyPersistence.test.tsx`
   used snake_case types and deleted every schema's seeds of that type; `itemProperty.test.tsx` also
   deleted every `model_schemas` row, Seed Protocol's links included. All of these React files and
   `model.test.tsx` now call `cleanupTestSchemaData({ items: true })`, which matches items by
   `model_file_id`; the SDK two now delete every item explicitly. `item.test.tsx`'s counts are exact.
   An earlier note said importing the schema once in `beforeAll` made per-test setup slower
   (3.8s → 4.1s). That compared against the old helper, whose `Item.create` ran on stale Model
   instances (bound to deleted rows) and skipped work; against correctly bound models, importing once
   is faster (see "Clean up with `cleanupTestSchemaData`").
6. **Fixed** (step 3). `modelProperty.test.tsx`'s "should automatically update when properties
   change (liveQuery integration)" asserted nothing after its setup. It now adds a property with
   `ModelProperty.create` and waits for the hook's list to show both properties.
7. **Fixed** (step 3). Tests that ignored a `waitUntil` timeout and passed anyway — by returning early
   ("Skip if we can't get the model ID"), creating the model the import should have made, sleeping and
   retrying, or logging a warning — now use `waitUntilOrThrow` and plain assertions: SDK `Schema.test`,
   `Model.test`; React `model`, `modelProperty`, `schema`, `liveQueryTiming` (which now waits for an
   emission containing the updated value). This turned up one wrong test: `Schema.test`'s `reload()`
   test edited a published row's `schemaData`, which `reload()` never reads (a published schema loads
   from its file; only draft rows load from `schemaData`); it now writes the edit as a draft.

### Failing on `main` (not caused by this work)

8. **Order-dependent `Item/unpublish.integration.test.ts` failures** ("Item is read-only: you do not
   own this item") when certain files (e.g. `Item/getItems.test.ts`) run before it on the same
   browser worker. Fixed in `9a41020` (each `createPublishedItemForUnpublish` call gets its own seed
   UID, `6d78fca`; the ownership check finds an item's row by `localId` before `uid`, `d149b56`).
   As of 2026-10-08 the same error came back after one particular set of 24 earlier browser files;
   a separate session is looking into it (owned addresses persisted in OPFS appState leak between
   files).
9. **Fixed** by `35d322b` (it now uses `vi.mock` instead of `vi.spyOn` on module namespaces).
10. **Fixed** by `35d322b` (removed the test's `@/node/db/Db` import).
11. **Fixed.** The tests ran a stale `packages/react/dist`; see "Workspace packages load from source".
12. **Rechecked in step 5; see below.** Flaky in `modelProperty.test.tsx`: `useModelProperties >
    should return properties when …` (30s timeout) and three `useModelProperty` tests (~17s),
    intermittently. Likely fixed by `22c3a7e` (RTL `cleanup()`, which removed a stale write for the
    file's deleted Post model from earlier tests' still-mounted hooks). Step 5 fixed the code-level
    causes it pointed at: finding 2, finding 15, and `useModelProperty`'s schemaId/modelFileId
    lookup, which ran once and kept `undefined` if the model or property wasn't there yet. It now
    retries quietly at 0.4/1.2/2.5s while it finds nothing (test: "finds a property whose model is
    created after the hook first looked it up"). Recheck on the branch: `modelProperty.test.tsx`
    passed 12 of 12 runs alone and 6 of 6 full browser-react runs, with no timeouts. Reopen if the
    timeout comes back. Earlier tests' stale writes still show up in this file (1–3 "Schema/Model
    with id N does not exist … Cannot create join record" per run, on `main` too); they are
    finding 14's SDK side.
13. **Fixed.** A stale `packages/eas/dist`; see "Workspace packages load from source".
14. **Writes that start after test cleanup has evicted their model.** The React files now use the
    SDK's `cleanupTestSchemaData`, which waits for in-flight writes (`4863469`). That removed the
    writes that were already running: `model.test.tsx` went from 5 stale-write errors per run to
    0–3. What's left are writes that *start* after the cleanup evicted and waited, so waiting can't
    catch them. Logging write starts against the cleanup showed two kinds:
    - The next test's import of the same schema writes the model, and its property insert fails a
      foreign key (`model_id` of a row the cleanup just deleted), so some cached state still holds the
      old `models` row id after eviction.
    - A runtime model that was already `stopped` (e.g. `NewItemModel`, created with `Model.create`
      in `itemProperty.test.tsx`) starts a write ~60ms after the cleanup.
    With a per-test delete-and-reimport, `itemProperty.test.tsx` showed 2 such errors per run where
    `main` showed none: `main`'s cleanup never deleted model rows, so these writes landed on orphaned
    rows silently. Importing that file's schema once (step 3) removed them there. Next step is in the
    SDK: find which cache keeps the old row id, and what restarts a stopped model's write process.
15. **Fixed** (step 5). `useModelProperties` memoized the model's `_dbId` once per model instance,
    so a model first seen before its row was resolved never got the live query on the `properties`
    table. Properties added later then only appeared through the fixed refetches, which run only
    while the list is empty. The hook now follows `_dbId` on the model's actor. Test: "picks up a
    property added after the model resolves its _dbId" in `modelProperty.test.tsx`.
16. **Fixed** (step 3, test side). `getItemsData({ modelName })`, `Item.all(name)` and
    `useItems({ modelName })` without `schemaName` / `modelFileId` list every schema's items with that
    model name. That's working as designed (2026-10-07): model types are global and a schema is a local
    lens over seeds. `Item/getItems.test.ts` now passes its Post's `modelFileId` (and its raw EAS-style
    seed records it), and react `item.test.tsx`'s `useItems` calls pass the file's `schemaName`.
17. **Fixed.** Test files threw inside a `waitFor` predicate (`throw new Error('… failed to load')`
    when the snapshot is `error`). Every SDK and React test now uses the non-throwing helpers in
    `packages/sdk/__tests__/test-utils/waitForIdle.ts` (see "Writing tests that stay fast").
18. **Fixed** (step 6, branch `claude/step6-getbyid-propschema`). `ModelProperty.getById` scanned
    the whole instance cache on every call, hit or miss. Loading a 1000-property model looks each
    property up by id (2,000–4,000 calls), so `getById` cost ~480ms there. It now uses an id index.
    Each cached instance subscribes to its actor to keep its entry current when its id changes (a
    property is often created with a generated id and then gets its real one). Entries are checked
    before use, and a stale one falls back to the old scan. Same load: ~2ms in `getById`. Test:
    `ModelProperty/getByIdIndex.test.ts`. `validation-timeout.test.ts` never loads its models'
    properties into the cache, so it didn't pay this cost.
19. **Fixed** (step 6). `getPropertySchema` didn't find properties added at runtime to a schema-file
    model. When the Schema context defines the model, it read properties only from there, and
    `ModelProperty.create({ modelName, name })` doesn't add the new property to it, so
    `useModelProperty(schema, model, newProperty)` stayed `undefined`. When the name isn't in the
    Schema context, it now also looks in `model.properties`; the schema file's definitions still win.
    The Schema context itself is unchanged (minimal fix, agreed 2026-10-08). Tests: "getPropertySchema
    finds a property added at runtime to a schema-file model" (`ModelProperty.test.ts`) and "finds a
    property added at runtime to a schema-file model" (`modelProperty.test.tsx`).

### Plan

Agreed order for the remaining findings (2026-10-07). Findings 1, 4, 9–11 and 13 were closed on branch
`fix/test-source-aliases` (merged in `843bf4e`), and 17 on `claude/nifty-heyrovsky-08dd27`.

- **Step 3 — done** (branch `claude/step3-test-cleanup`): 5, 6, 7 and 16 fixed; 14 narrowed to writes
  that start after eviction, which needs an SDK fix (see 14). `item.test.tsx` and
  `itemProperty.test.tsx` now import their schema once per file.
- **Step 4 — done** (branch `fix/eas-schema-lookup-cache`): finding 3 fixed. EAS schema lookups are
  cached, including misses; browser-react summed file time down ~34% back to back against `main`.
- **Step 5 — done** (branch `claude/step5-hooks-caches`): 2 and 15 fixed, 12 rechecked (see 12),
  `useModelProperty` retries a lookup that found nothing. New finding 19. Correctness only: suite
  times unchanged back to back against `main` (browser-react summed 181/181s → 185/203/179s,
  browser 230s → 231s, with 2 and 7 more tests).
- **Step 6 — done** (branch `claude/step6-getbyid-propschema`): 18 and 19 fixed.
- **Not scheduled:** 14's SDK side. Its first case (a cached Model handing back a deleted row's id
  after a re-import) is being worked on in a separate session as of 2026-10-08; look at the second
  case (a stopped runtime model starting a write) after that lands. Also open: sharing one browser
  `QueryClient` (see 3), which needs `claude/elegant-tu-ac5741`'s query-key fix merged first.
