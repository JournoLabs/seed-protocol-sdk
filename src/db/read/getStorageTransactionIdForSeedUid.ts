import { metadata } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'

const seedUidToStorageTransactionId = new Map<string, string>()

type GetStorageTransactionIdResults = {
  storageTransactionId: string
}[]

export const getStorageTransactionIdForSeedUid = async (
  seedUid: string,
): Promise<string | undefined> => {
  if (seedUidToStorageTransactionId.has(seedUid)) {
    return seedUidToStorageTransactionId.get(seedUid)
  }

  const appDb = BaseDb.getAppDb()

  const results = (await appDb
    .select({
      storageTransactionId: metadata.propertyValue,
    })
    .from(metadata)
    .where(
      and(
        eq(metadata.seedUid, seedUid),
        eq(metadata.propertyName, 'storageTransactionId'),
      ),
    )) as GetStorageTransactionIdResults

  if (!results || results.length === 0) {
    return
  }

  seedUidToStorageTransactionId.set(seedUid, results[0].storageTransactionId)
  return results[0].storageTransactionId
} 