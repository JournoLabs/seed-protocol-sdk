# Archive — patterns removed in 0.5.0 dependency simplification

Material here was removed from the live SDK/CLI during the `simplify-deps-0-5-0` work. Keep until confirmed irrelevant; do not reintroduce without a clear product need.

Contents:

- `codegen/` — Runtime TypeScript codegen (`ts-import`, nunjucks templates, drizzle schema generation from `seed.config.ts`)
- `commented/runSeedInit-cli-spawn.ts.txt` — CLI-spawn / npx seed-init orchestration
- `commented/browser-Db-legacy-migrate.ts.txt` — Browser DB hash-divergence delete-and-rebuild sketches
- `vite-index.ts.bak` — Vite plugin backup

## Current model (after 0.5.0)

- SDK SQLite tables: static `@/seedSchema` + prebuilt SQL in `packages/sdk/src/db/drizzle`, applied via `drizzle-orm` migrator (browser + Node).
- App domain schemas: JSON → OPFS/DB rows (EAV). No per-model Drizzle codegen at runtime.
- `drizzle-kit` remains a **monorepo** devDependency for SDK maintainers (`scripts/track-drizzle-changes.ts`), not a consumer install.

