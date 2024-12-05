import { seeds, SeedType } from '@/shared/seedSchema'
import { getAppDb } from '@/browser/db/sqlWasmClient'

type CreateSeeds = (newSeeds: Partial<SeedType>[]) => Promise<string[]>

export const createSeeds: CreateSeeds = async (
  newSeeds: Partial<SeedType>[],
) => {
  const appDb = getAppDb()

  const results = await appDb
    .insert(seeds)
    .values(newSeeds)
    .returning({ uid: seeds.uid })

  const newUids = results.reduce((acc, result) => {
    if (result.uid) {
      acc.push(result.uid)
    }
    return acc
  }, [] as string[])

  return newUids
}
