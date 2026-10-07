import { seeds, SeedType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { normalizePublisher } from '@/helpers/addresses'

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

  await appDb.insert(seeds).values(values)
}
