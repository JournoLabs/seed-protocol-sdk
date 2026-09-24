import { seeds, SeedType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { normalizePublisher } from '@/helpers/addresses'

type CreateSeeds = (newSeeds: Partial<SeedType>[]) => Promise<string[]>

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

  const results = await appDb
    .insert(seeds)
    .values(values)
    .returning({ uid: seeds.uid })

  const newUids = results.reduce((acc: string[], result: { uid: string | null }) => {
    if (result.uid) {
      acc.push(result.uid)
    }
    return acc
  }, [] as string[])

  return newUids
}
