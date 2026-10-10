import { describe, expect, it, vi } from 'vitest'
import { isSqliteBusyError, withSqliteBusyRetry } from '@/browser/db/sqliteBusyRetry'
import { canRunInTransaction, getEmbeddedMigrations } from '@/browser/db/embeddedMigrations'

const busy = () => new Error('SQLITE_BUSY: sqlite3 result code 5: database is locked')

describe('withSqliteBusyRetry', () => {
  it('retries a statement rejected with SQLITE_BUSY until it succeeds', async () => {
    const driver = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValue({ rows: [] })
    const retrying = withSqliteBusyRetry(driver, [1, 1, 1])

    await expect(retrying('UPDATE t SET a = ?', [1], 'run')).resolves.toEqual({ rows: [] })
    expect(driver).toHaveBeenCalledTimes(3)
    expect(driver).toHaveBeenLastCalledWith('UPDATE t SET a = ?', [1], 'run')
  })

  it('gives up after the last delay', async () => {
    const driver = vi.fn().mockRejectedValue(busy())
    await expect(withSqliteBusyRetry(driver, [1, 1])('SELECT 1')).rejects.toThrow('database is locked')
    expect(driver).toHaveBeenCalledTimes(3)
  })

  it('does not retry other errors', async () => {
    const driver = vi.fn().mockRejectedValue(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'))
    await expect(withSqliteBusyRetry(driver, [1, 1])('INSERT')).rejects.toThrow('UNIQUE')
    expect(driver).toHaveBeenCalledTimes(1)
  })

  it('recognizes SQLITE_BUSY and SQLITE_LOCKED messages only', () => {
    expect(isSqliteBusyError(busy())).toBe(true)
    expect(isSqliteBusyError(new Error('SQLITE_LOCKED: database table is locked'))).toBe(true)
    expect(isSqliteBusyError(new Error('SQLITE_IOERR: disk I/O error'))).toBe(false)
  })
})

describe('canRunInTransaction', () => {
  it('keeps migrations that toggle foreign_keys out of a transaction', () => {
    const migrations = getEmbeddedMigrations()
    const outside = migrations.filter((migration) => !canRunInTransaction(migration))
    // Only 0009 toggles PRAGMA foreign_keys today; a new one should be a deliberate choice.
    expect(outside).toHaveLength(1)
    expect(outside[0].sql.join('')).toMatch(/PRAGMA foreign_keys=OFF/)
  })
})
