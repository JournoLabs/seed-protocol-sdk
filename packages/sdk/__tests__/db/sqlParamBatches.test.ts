import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import {
  chunkValues,
  IN_LIST_BATCH,
  rowsPerInsert,
  selectInBatches,
  SQLITE_DEFAULT_MAX_VARIABLE_NUMBER,
} from '@/db/sqlParamBatches'
import { batchLatestPublishedVersionBySeedLocalIds } from '@/db/read/batchLatestPublishedVersionBySeedLocalIds'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { recordSqlParamCounts } from '../test-utils/recordSqlParamCounts'

/** NodeJS project only (db/** is excluded from the browser project). */
describe('chunkValues / selectInBatches', () => {
  it('splits a list into chunks of at most the batch size, keeping order', () => {
    const values = Array.from({ length: 2 * IN_LIST_BATCH + 3 }, (_, i) => i)
    const chunks = chunkValues(values)
    expect(chunks.map((c) => c.length)).toEqual([IN_LIST_BATCH, IN_LIST_BATCH, 3])
    expect(chunks.flat()).toEqual(values)
    expect(chunkValues([])).toEqual([])
    expect(chunkValues([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(() => chunkValues([1], 0)).toThrow()
  })

  it('keeps IN lists and full-row inserts under the default SQLite variable limit', () => {
    // Room for a second list of the same size (updateSeedRevokedAt binds metadata uids twice).
    expect(2 * IN_LIST_BATCH).toBeLessThan(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER)
    for (const table of [seeds, versions, metadata]) {
      const columns = Object.keys(getTableColumns(table)).length
      expect(rowsPerInsert(table) * columns).toBeLessThanOrEqual(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER)
      expect((rowsPerInsert(table) + 1) * columns).toBeGreaterThan(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER)
    }
  })

  it('runs one query per chunk and concatenates the rows', async () => {
    const seen: number[][] = []
    const rows = await selectInBatches(
      [1, 2, 3, 4, 5],
      async (chunk) => {
        seen.push(chunk)
        return chunk.map((n) => n * 10)
      },
      2,
    )
    expect(seen).toEqual([[1, 2], [3, 4], [5]])
    expect(rows).toEqual([10, 20, 30, 40, 50])
  })
})

describe('reads and writes with more than 999 ids', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

  it('batchLatestPublishedVersionBySeedLocalIds binds at most 999 parameters per statement', async () => {
    const seedLocalIds = ids('sqlp-seed-', 1200)
    const uid = '0x' + 'ab'.repeat(32)
    await BaseDb.getAppDb()
      .insert(versions)
      .values({ localId: 'sqlp-v-last', seedLocalId: seedLocalIds[1199], uid, createdAt: 1 })
    let result: Map<string, { uid: string }> = new Map()
    const counts = await recordSqlParamCounts(async () => {
      result = await batchLatestPublishedVersionBySeedLocalIds(seedLocalIds)
    })
    expect(Math.max(...counts)).toBeLessThanOrEqual(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER)
    expect(result.get(seedLocalIds[1199])?.uid).toBe(uid)
  })

  it('updateSeedRevokedAt binds at most 999 parameters per statement', async () => {
    const counts = await recordSqlParamCounts(() =>
      updateSeedRevokedAt({
        seedLocalId: 'sqlp-no-such-seed',
        revokedAt: 1,
        metadataUids: ids('sqlp-m-', 1200),
        versionUids: ids('sqlp-v-', 1200),
      }),
    )
    expect(Math.max(...counts)).toBeLessThanOrEqual(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER)
  })
})
