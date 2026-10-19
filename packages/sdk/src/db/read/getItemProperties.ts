import { GetItemProperties, PropertyData } from '@/types'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { getMetadataLatest } from './subqueries/metadataLatest'
import { isPublishedMetadataRow } from '@/helpers/isPublishedMetadataRow'
import { applyPendingRow, getPendingPropertyRows, propertyNameVariants } from '@/outbox/pendingValues'

/**
 * Puts each property's pending outbox value over its row (ADR 0019), as an unpublished edit, and adds
 * a row for a property that has a pending value but no row yet.
 */
async function withPendingRows(rows: any[], seedLocalId: string | null | undefined): Promise<any[]> {
  const pending = await getPendingPropertyRows(seedLocalId)
  if (pending.size === 0) return rows
  const out = rows.map((row) => {
    const name = propertyNameVariants(row.propertyName ?? '').find((variant) => pending.has(variant))
    if (!name) return row
    const overlay = pending.get(name)!
    pending.delete(name)
    if (overlay.stagedPath === undefined && overlay.propertyValue === row.propertyValue) return row
    return { ...applyPendingRow(row, overlay), uid: null, attestationRaw: null, derivedFromUid: null }
  })
  for (const [propertyName, overlay] of pending) {
    if (overlay.stagedPath !== undefined) continue
    out.push({ ...applyPendingRow({}, overlay), seedLocalId, propertyName, uid: null })
  }
  return out
}


export const getItemProperties: GetItemProperties = async ({
  seedLocalId,
  seedUid,
  edited,
}) => {
  const appDb = BaseDb.getAppDb()

  const metadataLatest = getMetadataLatest({seedLocalId, seedUid})

  const stored = await appDb
    .with(metadataLatest)
    .select()
    .from(metadataLatest)
    .where(eq(metadataLatest.rowNum, 1))
  const propertiesData = await withPendingRows(stored, seedLocalId ?? stored[0]?.seedLocalId)

  // `edited` picks properties by their current value (the row readers show): true = a local edit
  // not yet attested, false = published. Same test as getPublishPendingDiff.
  const selected =
    typeof edited === 'undefined'
      ? propertiesData
      : propertiesData.filter(
          (data: any) => isPublishedMetadataRow(data) !== edited,
        )

  return selected.map((data: any) => ({
    ...data,
    localId: data.localId || '',
    uid: data.uid || '',
    propertyName: data.propertyName || '',
    propertyValue: data.propertyValue || '',
    schemaUid: data.schemaUid || '',
    modelType: data.modelType || '',
    seedLocalId: data.seedLocalId || '',
  })) as PropertyData[]
}
