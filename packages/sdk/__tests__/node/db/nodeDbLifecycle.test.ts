// @vitest-environment node
/**
 * NodeDb's live queries complete when the database closes, instead of polling the closed client and
 * erroring; and it prunes entity_changes, which in the browser only the change feed does (batch 12).
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NodeDb } from '@/node/db/Db'
import { appState, entityChanges } from '@/seedSchema'
import { ENTITY_CHANGES_RETENTION_MS } from '@/db/entityChangesPrune'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-node-db-'))

const open = (dbFile: string) =>
  new NodeDb().prepareDb(path.join(tempDir(), '.seed'), {
    dbUrl: dbFile,
    outDir: path.join(tempDir(), 'migrations'),
  })

describe('NodeDb lifecycle', () => {
  it('completes open live queries on close, without an error', async () => {
    const nodeDb = new NodeDb()
    const db = await nodeDb.prepareDb(path.join(tempDir(), '.seed'), {
      dbUrl: path.join(tempDir(), 'seed.db'),
      outDir: path.join(tempDir(), 'migrations'),
    })
    const events: string[] = []
    const subscription = nodeDb.liveQuery(db.select().from(appState)).subscribe({
      next: () => events.push('next'),
      error: () => events.push('error'),
      complete: () => events.push('complete'),
    })
    await expect.poll(() => events.includes('next')).toBe(true)

    await nodeDb.close()
    // Past the next poll tick
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(events).toContain('complete')
    expect(events).not.toContain('error')
    subscription.unsubscribe()
  })

  it('prunes entity_changes rows older than the retention when it opens', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    const first = new NodeDb()
    const db = await first.prepareDb(path.join(tempDir(), '.seed'), {
      dbUrl: dbFile,
      outDir: path.join(tempDir(), 'migrations'),
    })
    await db.insert(entityChanges).values([
      { tbl: 'seeds', seedLocalId: 'old', at: Date.now() - ENTITY_CHANGES_RETENTION_MS - 1000 },
      { tbl: 'seeds', seedLocalId: 'recent', at: Date.now() },
    ])
    await first.close()

    const reopened = await open(dbFile)
    await expect
      .poll(async () => (await reopened.select().from(entityChanges)).map((row: { seedLocalId: string }) => row.seedLocalId))
      .toEqual(['recent'])
  })
})
