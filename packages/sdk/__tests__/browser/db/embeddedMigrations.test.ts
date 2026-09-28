import { describe, expect, it } from 'vitest'
import { getEmbeddedMigrations } from '@/browser/db/embeddedMigrations'

describe('getEmbeddedMigrations', () => {
  it('builds in-memory migrations from drizzleFiles without Node fs', () => {
    const migrations = getEmbeddedMigrations()
    expect(migrations.length).toBeGreaterThan(0)
    expect(migrations[0].sql.length).toBeGreaterThan(0)
    expect(migrations[0].hash).toMatch(/^[a-f0-9]{64}$/)
    expect(migrations[0].folderMillis).toBeGreaterThan(0)
  })
})
