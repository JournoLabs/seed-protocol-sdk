# Seed Protocol SDK

Bun workspaces under `packages/`. The SDK is `packages/sdk`; `react`, `publish`, `eas`, `arweave`,
`query` and the rest build on it. User docs are in `docs/`, decisions in `docs/adr/`.

## Architecture map

Each concept has one home. Use it; don't add a parallel one.

- **Entity instances:** `EntityCache` (`packages/sdk/src/helpers/entity/entityCache.ts`, ADR 0014)
  caches every Item, ItemProperty, Schema, Model and ModelProperty. Hooks and long-lived owners
  take a hold (`hold: true`, `retain`, `Item.create`) and `unload()` it; plain lookups
  (`find`, `all`, `getById`) take none. An unheld Item or ItemProperty unloads after
  `entityCache.unloadGraceMs` (60 s). Definitions (Schema, Model, ModelProperty) never unload on
  the grace timer.
- **Item writes:** the outbox (`packages/sdk/src/outbox/`, ADR 0019). Setters, `save`, create
  and delete append an op; appliers write the rows.
- **Reacting to row changes in the browser:** the change feed
  (`packages/sdk/src/browser/db/changeFeed.ts`, ADR 0020), not a liveQuery per entity.
- **Publish reads:** `getPublishGraph` (`packages/sdk/src/db/read/publishGraph.ts`).
- **Definition writes** (schemas, models, properties, model_schemas):
  `packages/sdk/src/db/write/definitions.ts`.
- **A property's current row:** `currentPropertyRow` (`packages/sdk/src/db/read/currentPropertyRow.ts`).
- **Image, File and Html saves:** `packages/sdk/src/storageValue/save.ts`.
- **Schema files:** `applySchemaFile` (`packages/sdk/src/helpers/schemaApply.ts`).

## Build and test

```bash
bun install
SKIP_TESTS=1 node scripts/build-packages.js
bun run lint
bun run test
```

`bun run test` (`scripts/test-all.js`) runs the type tests, the root vitest projects, each
package's tests, then the repo checks, and stops at the first failing step. Rerun the remaining
steps rather than the whole suite. Known flakes: `editAfterPublish` "points the property at the
new draft row" and `itemPropertyEditing` "keeps a value that breaks its rule shown". Rerun the file
once; if it fails again, it's a real failure. [docs/TESTING.md](docs/TESTING.md) covers the suite.

## Conventions

- A bug fix comes with a test that fails on the old code.
- Tests assert behaviour, not how it's implemented.
- Test defaults match production. A global override of a runtime default needs a comment saying
  why, and a test on the real default ([docs/TESTING.md](docs/TESTING.md#test-defaults-match-production)).
- No network in tests beyond this machine and the hosts in
  `packages/sdk/__tests__/test-utils/allowedTestHosts.ts`; the test setups block the rest. Mock at
  the network boundary or write a `*.live.test.ts` that runs only with `SEED_LIVE_NETWORK_TESTS=1`.
  Adding a host to the allowlist needs a reason in that file.
- No deprecated aliases. Remove the old name and mark it **Breaking** in the package's
  `CHANGELOG.md` under `## Unreleased`. PermaPress is the only consumer and adapts.
- Migrations: `bun run drizzle:update --name <what_it_does>` writes the next `NNNN_` file, its
  snapshot, its journal entry and `drizzleFiles.ts`. If main takes your number first, delete your
  migration, merge main and generate it again. `scripts/check-migrations.js` fails on a shared
  number, a gap or a stale `drizzleFiles.ts`.
- Write a dynamic import as `const { x } = await import('...')` inside an async function, never
  `import('...').then((n) => n.x)`: `scripts/check-dist-fragile-dynamic-imports.js` fails on it.
- Unused files, exports and dependencies fail `scripts/check-knip.js` once they exceed
  `scripts/knip-baseline.json`. Delete them, or add a false positive to `knip.jsonc` with a reason.
- No scratch files in the repo.
- Internal plans, logs and handoffs go in the gitignored `docs/private/`. Decisions go in
  `docs/adr/` ([template](docs/adr/template.md)).
