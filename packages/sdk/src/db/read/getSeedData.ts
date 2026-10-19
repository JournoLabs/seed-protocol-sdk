import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, SeedType } from '@/seedSchema'
import { eq } from 'drizzle-orm'

type GetSeedDataProps = {
  seedLocalId?: string
  seedUid?: string
}

type GetSeedData = (
  props: GetSeedDataProps,
  /** The database or transaction to read; the app database by default. */
  db?: ReturnType<typeof BaseDb.getAppDb>,
) => Promise<SeedType | undefined>

export const getSeedData: GetSeedData = async ({ seedLocalId, seedUid }, db = BaseDb.getAppDb()) => {
  const appDb = db

  let query

  const queryBase = appDb.select().from(seeds)

  if (seedLocalId) {
    query = queryBase.where(eq(seeds.localId, seedLocalId))
  }

  if (seedUid) {
    query = queryBase.where(eq(seeds.uid, seedUid))
  }

  const rows = await query

  if (!rows || !rows.length) {
    return
  }

  return rows[0]
}
