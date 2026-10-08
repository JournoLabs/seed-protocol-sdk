/**
 * Renders packages/sdk/src/browser/db/drizzleFiles.ts from the SDK's drizzle migration folder.
 *
 * The browser can't read the migration folder at runtime, so drizzleFiles.ts embeds it: one
 * `migrationSql_<tag>` export per journal entry (the .sql file verbatim), the journal, and the
 * newest snapshot. Used by scripts/update-drizzle.ts, and by drizzleMigrations.test.ts to check
 * the committed file is exactly what this renders.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export const SDK_DRIZZLE_DIR = path.join(repoRoot, 'packages/sdk/src/db/drizzle')
export const DRIZZLE_FILES_TS = path.join(repoRoot, 'packages/sdk/src/browser/db/drizzleFiles.ts')

type Journal = { entries: Array<{ idx: number; tag: string }> }

const escapeTemplateLiteral = (str: string) =>
  str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

const read = (file: string) => fs.readFileSync(file, 'utf-8')

export function renderDrizzleFilesTs(drizzleDir: string = SDK_DRIZZLE_DIR): string {
  const metaDir = path.join(drizzleDir, 'meta')
  const journalJson = read(path.join(metaDir, '_journal.json'))
  const journal = JSON.parse(journalJson) as Journal
  if (journal.entries.length === 0) throw new Error(`No migrations in ${metaDir}/_journal.json`)

  // Journal order is migration order; every entry must have its .sql file.
  const migrationExports = journal.entries.map(({ tag }) => {
    const sql = read(path.join(drizzleDir, `${tag}.sql`))
    return `export const migrationSql_${tag} = \`${escapeTemplateLiteral(sql)}\``
  })

  const latestTag = journal.entries[journal.entries.length - 1]!.tag
  const snapshotJson = read(path.join(metaDir, `${latestTag.slice(0, 4)}_snapshot.json`))

  return `// This file embeds the drizzle migration files as strings for browser runtime
// These files are copied from packages/sdk/src/db/drizzle at build time

// Individual migration SQL files
${migrationExports.join('\n\n')}

// Journal JSON file
export const journalJson = \`${escapeTemplateLiteral(journalJson)}\`

// Snapshot JSON file - this is large, so we'll import it dynamically if needed
// For now, we'll read it from the actual file if ?raw works, otherwise we'll need to embed it
export const snapshotJson = \`${escapeTemplateLiteral(snapshotJson)}\`
`
}
