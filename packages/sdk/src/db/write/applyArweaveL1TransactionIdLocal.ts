import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { and, eq, or } from 'drizzle-orm'

/**
 * After L1 confirmation, updates local `metadata` rows that still reference the ANS-104
 * DataItem id with the L1 bundle transaction id (for gateway URLs / validation). Does not
 * change on-chain attestations.
 */
export async function applyArweaveL1TransactionIdLocal(params: {
  seedLocalId: string
  versionLocalId?: string | null
  dataItemId: string
  l1TransactionId: string
}): Promise<void> {
  const { seedLocalId, versionLocalId, dataItemId, l1TransactionId } = params
  const appDb = BaseDb.getAppDb()
  if (!appDb) return

  const nameClause = or(
    eq(metadata.propertyName, 'storage_transaction_id'),
    eq(metadata.propertyName, 'storageTransactionId'),
  )

  const whereBase = and(
    eq(metadata.seedLocalId, seedLocalId),
    eq(metadata.propertyValue, dataItemId),
    nameClause,
  )

  const where =
    versionLocalId != null && versionLocalId !== ''
      ? and(whereBase, eq(metadata.versionLocalId, versionLocalId))
      : whereBase

  const rows = await appDb.select().from(metadata).where(where)
  if (!rows.length) return

  const now = Date.now()
  for (const row of rows) {
    const localId = row.localId
    if (!localId) continue

    let nextRef = row.refResolvedValue
    if (nextRef && nextRef.includes(dataItemId)) {
      nextRef = nextRef.split(dataItemId).join(l1TransactionId)
    }

    await appDb
      .update(metadata)
      .set({
        propertyValue: l1TransactionId,
        refResolvedValue: nextRef ?? row.refResolvedValue,
        refResolvedDisplayValue: row.refResolvedDisplayValue
          ? row.refResolvedDisplayValue.split(dataItemId).join(l1TransactionId)
          : row.refResolvedDisplayValue,
        updatedAt: now,
      })
      .where(eq(metadata.localId, localId))
  }
}
