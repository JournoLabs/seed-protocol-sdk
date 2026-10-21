import { seeds, SeedType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { normalizePublisher } from '@/helpers/addresses'
import { chunkValues, rowsPerInsert } from '@/db/sqlParamBatches'

type CreateSeeds = (newSeeds: Partial<SeedType>[]) => Promise<Set<string>>

/**
 * Inserts seed rows. A row whose uid another row already has (seeds.uid is unique for attested
 * uids) is not inserted. Returns the local ids of the rows inserted.
 */
export const createSeeds: CreateSeeds = async (
  newSeeds: Partial<SeedType>[],
) => {
  const appDb = BaseDb.getAppDb()

  const values = newSeeds.map((row) => {
    const publisher = normalizePublisher(row.publisher)
    return {
      ...row,
      ...(publisher ? { publisher } : {}),
    }
  })

  const inserted = new Set<string>()
  // Sync can create thousands of seeds at once: keep each INSERT under SQLite's parameter limit.
  for (const chunk of chunkValues(values, rowsPerInsert(seeds))) {
    const rows = await appDb
      .insert(seeds)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ localId: seeds.localId })
    for (const row of rows) if (row.localId) inserted.add(row.localId)
  }
  return inserted
}
