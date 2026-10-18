# 0018. Fixed SDK tables and app schemas as rows; no runtime code generation

- **Status:** Accepted
- **Date:** 2026-10-18 (records the 0.5.0 dependency simplification)
- **Scope:** `@seedprotocol/sdk` (`seedSchema`, `db/drizzle`, init), repo tooling

## Context

Before 0.5.0 the SDK generated code at runtime from `seed.config.ts`: TypeScript and Drizzle
tables per model (`ts-import`, nunjucks templates), started an `npx seed-init` CLI process during
init, and carried an experimental gRPC `SeedService`. That pulled heavy dependencies into consumer
installs, made init depend on spawning processes, and gave every app a different table layout.

## Decision

- The SDK's SQLite tables are fixed: the static schema in `seedSchema`, with prebuilt SQL
  migrations in `packages/sdk/src/db/drizzle`, applied by Drizzle's migrator in the browser and
  in Node.
- App schemas are JSON files stored as rows (`schemas`, `models`, `properties`) with item values in
  `metadata`. No per-model tables or code are generated at runtime.
- `drizzle-kit` is a repo dev dependency for maintainers who change the SDK's own tables, not a
  consumer dependency.
- The gRPC server experiment is dropped. Reviving it needs a product need first.

The removed code was kept under `docs/archive/` until this ADR; it remains in git history.

## Consequences

Installs are smaller and init runs no subprocess. Every app shares one table layout, so SDK
migrations apply everywhere. Item values are stored as rows of strings, so typing and validation
come from the schema at runtime rather than from table columns.

Generating TypeScript types from schema files at build time, for editor and compiler checks, is
compatible with this decision: it generates types, not tables, and nothing runs at app runtime.

## Alternatives considered

- **Keep per-model generated tables.** Typed columns, but a migration per app schema change and
  codegen in every install.
- **Keep the RPC server in the repo unwired.** It had no users and drifted from the SDK.
