import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import * as seedSchema from '@/seedSchema'
import * as drizzleFiles from '@/browser/db/drizzleFiles'

/**
 * The migration folder is generated with `drizzle-kit generate`, which diffs the schema against
 * the newest snapshot in `meta/`. These checks keep that folder (and the browser's embedded copy
 * in drizzleFiles.ts) consistent, so the next `generate` produces only the intended change.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const drizzleDir = path.resolve(here, '../../src/db/drizzle')
const metaDir = path.join(drizzleDir, 'meta')

type JournalEntry = { idx: number; tag: string }
type Snapshot = { id: string; prevId: string } & Record<string, unknown>

const journal = JSON.parse(
  fs.readFileSync(path.join(metaDir, '_journal.json'), 'utf-8'),
) as { entries: JournalEntry[] }

const snapshotPath = (tag: string) =>
  path.join(metaDir, `${tag.slice(0, 4)}_snapshot.json`)

const readSnapshot = (tag: string): Snapshot =>
  JSON.parse(fs.readFileSync(snapshotPath(tag), 'utf-8'))

describe('drizzle migrations folder', () => {
  it('has a snapshot for every journal entry', () => {
    const missing = journal.entries
      .map((e) => e.tag)
      .filter((tag) => !fs.existsSync(snapshotPath(tag)))
    expect(missing).toEqual([])
  })

  it('chains snapshots in journal order (each prevId is the previous id)', () => {
    const tags = journal.entries.map((e) => e.tag).filter((t) => fs.existsSync(snapshotPath(t)))
    const links = tags.slice(1).map((tag, i) => ({
      tag,
      prevId: readSnapshot(tag).prevId,
      expected: readSnapshot(tags[i]!).id,
    }))
    expect(links.filter((l) => l.prevId !== l.expected)).toEqual([])
  })

  it('newest snapshot matches the schema (drizzle-kit generate would produce nothing)', async () => {
    const latest = readSnapshot(journal.entries[journal.entries.length - 1]!.tag)
    const current = await generateSQLiteDrizzleJson(
      seedSchema as Record<string, unknown>,
      latest.id,
    )
    const statements = await generateSQLiteMigration(latest as any, current)
    expect(statements).toEqual([])
  })

  it("matches the browser's embedded copies in drizzleFiles.ts", () => {
    const embedded = drizzleFiles as Record<string, string>
    expect(JSON.parse(embedded.journalJson!)).toEqual(journal)
    const latestTag = journal.entries[journal.entries.length - 1]!.tag
    expect(JSON.parse(embedded.snapshotJson!)).toEqual(readSnapshot(latestTag))
    for (const { tag } of journal.entries) {
      const sql = fs.readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf-8')
      expect(embedded[`migrationSql_${tag}`]?.trim(), tag).toBe(sql.trim())
    }
  })
})
