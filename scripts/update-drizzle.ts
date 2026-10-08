#!/usr/bin/env bun
/**
 * Generate an SDK migration from schema changes and refresh the browser's embedded copy.
 *
 *   bun run drizzle:update                      # migration for changes in packages/sdk/src/seedSchema
 *   bun run drizzle:update --name add_foo_to_bar
 *   bun run drizzle:update --custom --name backfill_foo   # empty migration to hand-write (data fixes)
 *   bun run drizzle:update --embed-only         # only regenerate drizzleFiles.ts
 *
 * Steps:
 * 1. `drizzle-kit generate` with packages/sdk/src/db/configs/migrations.config.ts. It diffs the
 *    schema (packages/sdk/src/seedSchema/*Schema.ts) against the newest snapshot in
 *    packages/sdk/src/db/drizzle/meta and writes the next NNNN_<name>.sql, its snapshot and the
 *    journal entry there. With no schema changes it writes nothing.
 * 2. Regenerates packages/sdk/src/browser/db/drizzleFiles.ts from that folder (one
 *    `migrationSql_<tag>` export per migration, the journal, the newest snapshot; see
 *    packages/sdk/scripts/drizzleFiles.ts).
 *
 * After hand-editing a migration's SQL (a `--custom` one, or a generated one you extended), run
 * `--embed-only` so drizzleFiles.ts picks up the edit. On a clean tree the script changes nothing.
 * packages/sdk/__tests__/db/drizzleMigrations.test.ts checks the folder, the snapshot chain and
 * drizzleFiles.ts are in sync.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIZZLE_FILES_TS, renderDrizzleFilesTs } from '../packages/sdk/scripts/drizzleFiles'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = 'packages/sdk/src/db/configs/migrations.config.ts'

const args = process.argv.slice(2)
const embedOnly = args.includes('--embed-only')
const generateArgs = args.filter((arg) => arg !== '--embed-only')

if (!embedOnly) {
  console.log(`Running drizzle-kit generate (${CONFIG})...`)
  const result = spawnSync('bunx', ['drizzle-kit', 'generate', `--config=${CONFIG}`, ...generateArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error('drizzle-kit generate failed')
    process.exit(result.status ?? 1)
  }
}

const rendered = renderDrizzleFilesTs()
const relative = path.relative(repoRoot, DRIZZLE_FILES_TS)
if (fs.existsSync(DRIZZLE_FILES_TS) && fs.readFileSync(DRIZZLE_FILES_TS, 'utf-8') === rendered) {
  console.log(`${relative} is up to date`)
} else {
  fs.writeFileSync(DRIZZLE_FILES_TS, rendered, 'utf-8')
  console.log(`Updated ${relative}`)
}
