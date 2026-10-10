import { seeds, SeedType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { normalizePublisher } from '@/helpers/addresses'
import { chunkValues, rowsPerInsert } from '@/db/sqlParamBatches'

type CreateSeeds = (newSeeds: Partial<SeedType>[]) => Promise<void>

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

  // Sync can create thousands of seeds at once: keep each INSERT under SQLite's parameter limit.
  for (const chunk of chunkValues(values, rowsPerInsert(seeds))) {
    await appDb.insert(seeds).values(chunk)
  }
}
