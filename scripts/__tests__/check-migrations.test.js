import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { embeddedCopyProblems, migrationFolderProblems } from '../check-migrations.js'
import { DRIZZLE_FILES_TS, SDK_DRIZZLE_DIR } from '../../packages/sdk/scripts/drizzleFiles.ts'

const pad = (n) => String(n).padStart(4, '0')
const committedEntries = JSON.parse(readFileSync(join(SDK_DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')).entries
const LAST = committedEntries.at(-1).tag
const N = committedEntries.length - 1
const lastName = LAST.slice(5)

describe('check-migrations', () => {
  let dir
  let drizzle
  let embedded
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-migrations-'))
    drizzle = join(dir, 'drizzle')
    embedded = join(dir, 'drizzleFiles.ts')
    cpSync(SDK_DRIZZLE_DIR, drizzle, { recursive: true })
    cpSync(DRIZZLE_FILES_TS, embedded)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const journalPath = () => join(drizzle, 'meta', '_journal.json')
  const editJournal = (edit) => {
    const journal = JSON.parse(readFileSync(journalPath(), 'utf8'))
    edit(journal)
    writeFileSync(journalPath(), JSON.stringify(journal, null, 2))
  }

  it('passes on the committed folder', () => {
    assert.deepEqual(migrationFolderProblems(drizzle), [])
    assert.deepEqual(embeddedCopyProblems(drizzle, embedded), [])
  })

  it('reports a number two migrations use', () => {
    writeFileSync(join(drizzle, `${pad(N)}_other_branch.sql`), 'SELECT 1;')
    assert.deepEqual(migrationFolderProblems(drizzle), [
      `migration number ${pad(N)} is used by ${LAST}, ${pad(N)}_other_branch`,
    ])
  })

  it('reports a gap in the numbers', () => {
    renameSync(join(drizzle, `${LAST}.sql`), join(drizzle, `${pad(N + 2)}_${lastName}.sql`))
    assert.deepEqual(migrationFolderProblems(drizzle), [`migration numbers skip from ${pad(N - 1)} to ${pad(N + 2)}`])
  })

  it('reports a migration missing from the journal', () => {
    editJournal((journal) => journal.entries.pop())
    const problems = migrationFolderProblems(drizzle)
    assert.ok(problems.includes(`${LAST}.sql is not in meta/_journal.json`), problems.join('\n'))
  })

  it('reports a journal entry whose `when` is not after the previous one', () => {
    editJournal((journal) => {
      journal.entries[N].when = journal.entries[N - 1].when
    })
    assert.match(migrationFolderProblems(drizzle).join('\n'), new RegExp(`has \`when\` \\d+, not after ${pad(N - 1)}_`))
  })

  it('reports a missing snapshot', () => {
    rmSync(join(drizzle, 'meta', `${pad(N)}_snapshot.json`))
    assert.deepEqual(migrationFolderProblems(drizzle), [`meta/${pad(N)}_snapshot.json is missing`])
  })

  it('reports drizzleFiles.ts out of date after a migration is edited', () => {
    appendFileSync(join(drizzle, `${LAST}.sql`), '\n-- edited\n')
    assert.deepEqual(embeddedCopyProblems(drizzle, embedded), [
      'drizzleFiles.ts is out of date; run `bun run drizzle:update --embed-only`',
    ])
  })
})
