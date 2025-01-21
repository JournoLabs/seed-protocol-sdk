import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { and, eq, isNotNull, not, or } from 'drizzle-orm'

type GetExistingItemProps = {
  seedLocalId: string
  seedUid: string
}

type GetExistingItemReturn = {
  seedLocalId: string
  seedUid: string
  createdAt: string
}

export const getExistingItem = async ({
  seedLocalId,
  seedUid,
}: GetExistingItemProps): Promise<GetExistingItemReturn | undefined> => {
  const appDb = BaseDb.getAppDb()

  const rows = await appDb
    .select({
      seedLocalId: seeds.localId,
      seedUid: seeds.uid,
      createdAt: seeds.createdAt,
    })
    .from(seeds)
    .where(
      or(
        and(
          isNotNull(seeds.uid),
          not(eq(seeds.uid, '')),
          not(eq(seeds.uid, 'undefined')),
          not(eq(seeds.uid, 'null')),
          not(eq(seeds.uid, 'false')),
          not(eq(seeds.uid, '0')),
          eq(seeds.uid, seedUid)
        ),
        and(
          isNotNull(seeds.localId),
          not(eq(seeds.localId, '')),
          not(eq(seeds.localId, 'undefined')),
          not(eq(seeds.localId, 'null')),
          not(eq(seeds.localId, 'false')),
          not(eq(seeds.localId, '0')),
          eq(seeds.localId, seedLocalId)
        )
      )
    )

  if (!rows || rows.length === 0) {
    return undefined
  }

  const matchingRow = rows.find(row => row.seedUid === seedUid) ||
    rows.find(row => row.seedLocalId === seedLocalId)

  return matchingRow
} 