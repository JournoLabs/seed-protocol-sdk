# Testing

How the vitest suite is configured and how to write tests that stay fast and reliable. Run it
with `bun run test`; see `vite.config.js` for the three projects (NodeJS, browser, browser-react).

## How the suite is set up

- **Parallel workers.** `vite.config.js` runs 4 NodeJS workers and 3 workers per browser project.
  Each browser worker gets its own Playwright browser context (separate OPFS and localStorage), and
  each Node file runs in its own forked process with its own temp project dir, so files on different
  workers don't share storage. Files on the *same* browser worker still run one after another against
  shared OPFS.
- **Browser teardown clears the database.** `teardownTestEnvironment` (`test-utils/client-init.ts`)
  runs `cleanupTestSchemaData({ items: true })` in the browser, not just the schema-file cleanup, so
  the next file on the worker starts without this file's schemas, models, properties and items.
- **`TEST_WORKERS`** overrides the per-project worker count. `TEST_WORKERS=1 bun run test` restores
  one-file-at-a-time runs, which is what you want when chasing an order-dependent failure.
- **`sequence.groupOrder`** is required: vitest refuses to run projects with different `maxWorkers`
  in the same group. NodeJS is group 0; both browser projects are group 1 and run concurrently. A new
  vitest project needs a `groupOrder` too.
- **`DEBUG` is opt-in.** Use
  `DEBUG='seedSdk:*' bun run test` when you need it.
- **Setup hooks use `SETUP_HOOK_TIMEOUT_MS` (30s)** from `test-utils/client-init.ts` in both
  `packages/sdk/__tests__` and `packages/react/__tests__`, matching `hookTimeout` in `vite.config.js`
  (all three projects). Healthy setup peaks around 9s, so a hung setup fails in 30s.
- **Workspace packages load from source.** `@seedprotocol/react`, `eas`, `arweave` and `query` are
  aliased to their `src` in every project (`workspaceSourceAliases` in `vite.config.js`). Their
  package exports point at gitignored `dist` builds, which tests would otherwise run stale. A new workspace
  package the tests import needs an alias too. If Vite logs "optimized dependencies changed.
  reloading" in a browser run, every file in flight fails to import; add the named dependencies to
  that project's `optimizeDeps.include`. Those entries resolve from the repo root, and bun keeps
  package dependencies under `packages/*/node_modules`, so a dependency that isn't hoisted also needs
  a root `devDependencies` entry (as `js-yaml` and `parse5` have). Vite logs "Failed to resolve
  dependency: …, present in client 'optimizeDeps.include'" for entries it can't resolve.

## Test defaults match production

A global override of a runtime default (in a setup file, a shared test config, or a branch on
`NODE_ENV`) needs a comment saying why and what production does, and at least one test that runs
on the real default. Otherwise the suite tests a configuration no user runs: a setup that set the
unload grace period to 0 hid a regression on main, and init errors that only test runs swallowed
let a broken init pass.

The overrides, and the tests on the real default:

| Override | Production | Test on the default |
| --- | --- | --- |
| Unload grace period 0 (`test-utils/noUnloadGrace.ts`) | 60 s | `helpers/entityCacheGrace.test.ts` |
| Browser `filesDir` `/app-files` (`createTestConfig`) | `.seed` | react `SeedProviderInit.test.tsx` (empty config) |
| No retries when offline (`helpers/retryWhenOnline.ts`, `NODE_ENV=test`) | on | `events/item/easSyncManager.test.ts` |
| Page without newer builtins (`test-utils/oldestBrowser.ts`) | the user's browser | every Node test, and the browser workers |

## No network in tests

Tests reach only this machine (localhost, `*.localhost` and loopback addresses) and the hosts in
`packages/sdk/__tests__/test-utils/allowedTestHosts.ts`. A request to any other host fails, and so
does the test that made it, even when the code under test caught the error. A test that read from
arweave.net on every run flaked whenever the gateway was slow.

- **Node:** `packages/sdk/__tests__/test-utils/noNetwork.node.ts`, a setup file of the NodeJS
  project and of every package's `vitest.config.ts`, blocks TCP connections
  (`net.Socket.prototype.connect`, which http, https, undici, `fetch` and `WebSocket` use) and
  wraps `fetch` and `WebSocket` for a message naming the URL. `packages/publish/bunfig.toml`
  preloads `noNetwork.bun.ts`, the same guard for `bun test`.
- **Browser:** `noNetwork.browser.ts`, imported by both `setup.browser.ts` files, wraps `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`. Chromium's
  `--host-resolver-rules` (set in `vite.config.js`) fails DNS for every host but localhost and the
  allowed ones, which covers workers and `<img>` loads; those fail without a message naming them.

`allowedTestHosts.ts` maps each allowed host to the reason tests need the real service. It holds
`optimism-sepolia.easscan.org`, the SDK's default EAS indexer: item saves and model init look up
schemas there, in most SDK tests. Adding a host needs a reason in that file.

To fix a blocked request, mock it at the network boundary: stub `fetch`, configure a mock client
(`MockArweaveClient`), or start a local server.

### Arweave tests

`ArweaveClient.arlocal.test.ts` and `integration/ArweaveFlows.test.ts` run the real Node Arweave
client against a local Arweave node ([arlocal](https://github.com/textury/arlocal), started on a
free port by `__tests__/test-utils/arlocal.ts`), so it makes HTTP requests the way it would against
a gateway and needs no network. arlocal 1.1.66 has no `/raw/<id>` route, so the fixture puts a small
server in front of it that answers `/raw/<id>` from `/<id>`.

Use `startLocalArweave()` from that file in other tests that need an Arweave node, and
`pinArweaveClientTo(node)` to pin reads to it with `ARWEAVE_READ_GATEWAYS`. `postTransaction` signs,
posts and mines a transaction so it is readable at once (`{ mine: false }` leaves it unmined), and
`failRawRead(id, status)` makes `/raw/<id>` answer with a gateway error.

### Live network tests

Files named `*.live.test.ts` call real services and are skipped unless `SEED_LIVE_NETWORK_TESTS=1`,
which also turns the guards off, so a slow or unreachable gateway can't fail `bun run test`.
`ArweaveClient.live.test.ts` probes arweave.net, zigza.xyz and vilenarios.com, logs each one's
`/info` and known-transaction status, and runs the client against the first that serves the
transaction; status checks fall back across all three. It fails only when none of them does. With
`SEED_GATEWAY_HYPER_KEY` set, status checks ask the Hyper gateway first:

```bash
SEED_LIVE_NETWORK_TESTS=1 bunx vitest run --project NodeJS packages/sdk/__tests__/helpers/ArweaveClient/ArweaveClient.live.test.ts
```

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
    instead of being ignored.
- **Use `WAIT_TIMEOUT_MS` for waits on things that should happen** (`test-utils/timeouts.ts`, 15s;
  React tests import it from `../../sdk/__tests__/test-utils/timeouts`). It's the default for
  `waitForIdle` and `waitUntilOrThrow`; pass it to xstate `waitFor`, `vi.waitFor` (whose default is
  only 1s) and Testing Library's `waitFor`. The Release workflow's GitHub runner takes ~2× as long
  as a dev machine for the suite, and 1–5s waits sized locally failed there (later 10s ones too,
  under heavy local load). A wait that never succeeds still fails before the 30s `testTimeout`,
  with its own message. Don't give a test its own timeout below that default: it only makes the
  test fail sooner on a slow machine.
- **Don't wait for a transient state.** The write process's `success` state returns to `idle` after
  2s, so a test that waits for `success` after doing other work hangs on a slow run: the write
  already finished. Wait on something that stays put (`context.writeStatus`), or start waiting
  before triggering the work.
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
- **Create items once for tests that only read them.** Group read-only tests under a `beforeAll`
  that creates the items, and give only the tests that edit, create, delete or uncache items their
  own per test (react `item.test.tsx` does this). Each `Item.create` costs ~0.4–0.8s
  locally and several times that on the CI runner.
- **React tests are unmounted for you.** `packages/react/__tests__/setup.browser.ts` calls Testing
  Library's `cleanup()` after each test. Vitest runs without `globals`, so Testing Library doesn't
  register it itself; before that was added, every tree a test rendered stayed mounted for the rest
  of the file (clearing `document.body` only detaches containers), and its hooks kept refetching
  while the next `beforeEach` deleted and re-imported the schema.
- In browser tests the page's `console.log` isn't printed; use `console.warn` for probes.
- **EAS schema lookups are cached per page / process**, including misses. A test that
  stubs the EAS client and needs a fresh lookup should call `resetSchemaUidCaches()` from
  `@seedprotocol/eas` first (as `schemaUidCache.test.ts` does).
- Fixed sleeps are fine for: delays inside polling loops and windows that assert something does *not*
  happen (no extra callbacks/emissions). Html/File/Image values don't need one: `Item.create` and
  `ItemProperty.save()` resolve after the file and its metadata are written, so a reload right after
  them sees the value.

## Large schema imports

`validation-timeout.test.ts` imports schemas with 1000 models, 500 models, and one model with 1000
properties. Each import runs about 20,000 SQLite queries, so under heavy machine load these tests
can still time out. If they fail, check machine load before looking for a regression.

## Running the Release job locally

The Release workflow's "Lint and test" job (`jobs.test` in `.github/workflows/release.yml`) runs on
every push to main. Three local checks cover its failures before a merge, from cheapest to most
faithful.

**Pre-push hook.** `.githooks/pre-push` runs `bun install --frozen-lockfile --dry-run`, which fails
when a `package.json` change isn't in `bun.lock`, then `bun run lint --quiet`, then
`scripts/check-migrations.js`, which fails when two migrations share a number or `drizzleFiles.ts`
is stale. It isn't installed by default. Turn it on per clone with:

```bash
git config core.hooksPath .githooks
```

`git push --no-verify` skips it once. Lint takes about 5s on a dev machine.

**`bun run ci:local`** runs the job's `run:` steps in order: `bun install --frozen-lockfile`,
`playwright install chromium`, `bun run lint`, the package build, then `bun run test`. It reads the
steps from `release.yml`, so a step added there runs here too. The first failure stops the run, and
it prints each step's time at the end. `--repeat N` runs the test step N times.

**`bun run ci:local --docker`** runs the same job in a Linux container limited to 2 CPUs and 7 GB
of memory (override with `--cpus` and `--memory`). Timing races that only fail on the GitHub runner
show up here, where a 10-core Mac hides them; combine it with `--repeat N` to chase one. The image
(`scripts/ci-docker/Dockerfile`) is the `mcr.microsoft.com/playwright` image for the playwright
version in `bun.lock`, with the latest Node of the `.nvmrc` major and the workflow's
`BUN_VERSION`. The repo goes in as a copy of its tracked and untracked-but-not-ignored files, so
uncommitted changes are tested, and the container installs its own `node_modules` and builds its
own `dist`. Only Bun's download cache persists, in the `seed-ci-local-bun-cache` volume. Docker
Desktop must allow at least 2 CPUs and 7 GB.

The container runs at the host's architecture, which is arm64 on Apple Silicon, while GitHub runs
x64. A Node patch release after the image was built isn't picked up until you remove the image
(`docker image rm` the `seed-ci-local:*` tag).

[act](https://github.com/nektos/act) can run the workflow file itself:

```bash
act push -W .github/workflows/release.yml -j test --container-options "--cpus=2 --memory=7g"
```

The `-W` is needed because `pr-tests.yml` also has a job named `test`. act runs the steps in its
own runner image rather than GitHub's, and has no repository secrets. On Apple Silicon it runs
arm64 unless given `--container-architecture linux/amd64`, which emulates x64 and is much slower
than the runner. `ci:local --docker` avoids these differences for the test step, so prefer it.
