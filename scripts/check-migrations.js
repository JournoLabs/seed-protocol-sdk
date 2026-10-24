#!/usr/bin/env node
/**
 * Fails when the SDK's drizzle migrations are out of order or out of sync:
 *
 * - the NNNN_<name>.sql files in packages/sdk/src/db/drizzle are not numbered 0000, 0001, ...
 *   with no gaps and no number used twice (two branches that each took the next number);
 * - meta/_journal.json doesn't list exactly those files, in that order, with `idx` equal to the
 *   number and `when` increasing (drizzle's migrator skips a migration whose `when` is not newer
 *   than the last one applied, so a renumbered migration must also get a later `when`);
 * - meta/ doesn't hold one NNNN_snapshot.json per migration, chained by prevId;
 * - packages/sdk/src/browser/db/drizzleFiles.ts is not what `bun run drizzle:update --embed-only`
 *   renders from the folder.
 *
 *   node scripts/check-migrations.js [--dir <drizzle dir>] [--embedded <drizzleFiles.ts>]
 *
 * The flags point it at a copy, for testing the check itself.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRIZZLE_FILES_TS, SDK_DRIZZLE_DIR, renderDrizzleFilesTs } from '../packages/sdk/scripts/drizzleFiles.ts'

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/

/**
 * Problems with the migration folder `drizzleDir`, as messages. Empty when it is consistent.
 * @param {string} drizzleDir
 * @returns {string[]}
 */
export function migrationFolderProblems(drizzleDir) {
  const problems = []
  const sqlFiles = readdirSync(drizzleDir).filter((name) => name.endsWith('.sql')).sort()
  for (const name of sqlFiles) {
    if (!MIGRATION_FILE.test(name)) problems.push(`${name}: not named NNNN_<snake_case_name>.sql`)
  }
  const migrations = sqlFiles
    .filter((name) => MIGRATION_FILE.test(name))
    .map((name) => ({ number: Number(name.slice(0, 4)), tag: name.slice(0, -'.sql'.length) }))

  const byNumber = new Map()
  for (const m of migrations) byNumber.set(m.number, [...(byNumber.get(m.number) ?? []), m.tag])
  for (const [number, tags] of byNumber) {
    if (tags.length > 1) problems.push(`migration number ${pad(number)} is used by ${tags.join(', ')}`)
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b)
  numbers.forEach((number, i) => {
    if (number !== i) problems.push(`migration numbers skip from ${pad(numbers[i - 1] ?? -1)} to ${pad(number)}`)
  })
  if (problems.length > 0) return problems // the journal checks below assume one file per number

  const metaDir = path.join(drizzleDir, 'meta')
  const journal = JSON.parse(readFileSync(path.join(metaDir, '_journal.json'), 'utf8'))
  const entries = journal.entries ?? []
  const fileTags = migrations.map((m) => m.tag)
  const journalTags = entries.map((e) => e.tag)
  for (const tag of fileTags.filter((t) => !journalTags.includes(t))) {
    problems.push(`${tag}.sql is not in meta/_journal.json`)
  }
  for (const tag of journalTags.filter((t) => !fileTags.includes(t))) {
    problems.push(`meta/_journal.json lists ${tag}, which has no .sql file`)
  }
  entries.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`meta/_journal.json entry ${i} (${entry.tag}) has idx ${entry.idx}`)
    if (entry.tag && Number(entry.tag.slice(0, 4)) !== i) {
      problems.push(`meta/_journal.json entry ${i} is ${entry.tag}; entries must follow the file numbers`)
    }
    const prev = entries[i - 1]
    if (prev && !(entry.when > prev.when)) {
      problems.push(`meta/_journal.json: ${entry.tag} has \`when\` ${entry.when}, not after ${prev.tag} (${prev.when})`)
    }
  })

  const snapshots = readdirSync(metaDir).filter((name) => name.endsWith('_snapshot.json')).sort()
  const expectedSnapshots = fileTags.map((tag) => `${tag.slice(0, 4)}_snapshot.json`)
  for (const name of expectedSnapshots.filter((s) => !snapshots.includes(s))) problems.push(`meta/${name} is missing`)
  for (const name of snapshots.filter((s) => !expectedSnapshots.includes(s))) problems.push(`meta/${name} has no migration`)
  let prevId
  for (const name of expectedSnapshots) {
    const file = path.join(metaDir, name)
    if (!existsSync(file)) break
    const snapshot = JSON.parse(readFileSync(file, 'utf8'))
    if (prevId !== undefined && snapshot.prevId !== prevId) {
      problems.push(`meta/${name}: prevId ${snapshot.prevId} is not the previous snapshot's id ${prevId}`)
    }
    prevId = snapshot.id
  }
  return problems
}

/**
 * A problem message when `embeddedFile` is not what drizzleFiles.ts renders from `drizzleDir`.
 * @param {string} drizzleDir
 * @param {string} embeddedFile
 * @returns {string[]}
 */
export function embeddedCopyProblems(drizzleDir, embeddedFile) {
  let rendered
  try {
    rendered = renderDrizzleFilesTs(drizzleDir)
  } catch (error) {
    return [`could not render drizzleFiles.ts: ${error.message}`]
  }
  const committed = existsSync(embeddedFile) ? readFileSync(embeddedFile, 'utf8') : ''
  if (rendered === committed) return []
  return [`${path.basename(embeddedFile)} is out of date; run \`bun run drizzle:update --embed-only\``]
}

const pad = (n) => String(n).padStart(4, '0')

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : path.resolve(process.argv[i + 1])
}

function main() {
  const drizzleDir = argValue('--dir', SDK_DRIZZLE_DIR)
  const embeddedFile = argValue('--embedded', DRIZZLE_FILES_TS)
  const problems = migrationFolderProblems(drizzleDir)
  if (problems.length === 0) problems.push(...embeddedCopyProblems(drizzleDir, embeddedFile))
  for (const problem of problems) console.error(`[check-migrations] ${problem}`)
  if (problems.some((p) => p.startsWith('migration number'))) {
    console.error(
      '[check-migrations] If main took your migration number: delete your migration (.sql, its ' +
        'snapshot and journal entry), merge main, and generate it again with `bun run drizzle:update` ' +
        '(for a --custom one, paste your SQL into the new file and run it with --embed-only).',
    )
  }
  if (problems.length > 0) process.exit(1)
  console.log(`[check-migrations] ${readdirSync(drizzleDir).filter((n) => n.endsWith('.sql')).length} migrations in order`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
