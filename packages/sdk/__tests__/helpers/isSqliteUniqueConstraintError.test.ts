import { describe, it, expect } from 'vitest'
import { isSqliteUniqueConstraintError } from '@/helpers/isSqliteUniqueConstraintError'

describe('isSqliteUniqueConstraintError', () => {
  it('matches native UNIQUE constraint message', () => {
    expect(
      isSqliteUniqueConstraintError(
        new Error('UNIQUE constraint failed: properties.name, properties.model_id'),
      ),
    ).toBe(true)
  })

  it('matches SQLITE_CONSTRAINT_UNIQUE code', () => {
    const err = Object.assign(new Error('constraint'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    })
    expect(isSqliteUniqueConstraintError(err)).toBe(true)
  })

  it('matches numeric rc 2067', () => {
    const err = Object.assign(new Error('sqlite3_step failed'), { code: 2067 })
    expect(isSqliteUniqueConstraintError(err)).toBe(true)
  })

  it('matches drizzle Failed query with UNIQUE cause', () => {
    const cause = Object.assign(
      new Error('sqlite3_step() rc= 2067 SQLITE_CONSTRAINT_UNIQUE SQL = insert into "properties"'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    )
    const drizzleError = Object.assign(
      new Error(
        'Failed query: insert into "properties" ("id", "name", "data_type", "model_id") values (null, ?, ?, ?)',
      ),
      { cause },
    )
    expect(isSqliteUniqueConstraintError(drizzleError)).toBe(true)
  })

  it('matches Failed query whose message embeds SQLITE_CONSTRAINT_UNIQUE', () => {
    expect(
      isSqliteUniqueConstraintError(
        new Error('Failed query: insert...\nSQLITE_CONSTRAINT_UNIQUE'),
      ),
    ).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isSqliteUniqueConstraintError(new Error('Failed query: select 1'))).toBe(false)
    expect(isSqliteUniqueConstraintError(new Error('database is locked'))).toBe(false)
    expect(isSqliteUniqueConstraintError(null)).toBe(false)
    expect(isSqliteUniqueConstraintError(undefined)).toBe(false)
    expect(isSqliteUniqueConstraintError('not unique')).toBe(false)
  })
})
