import { GetItemProperties, PropertyData } from '@/types'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { getMetadataLatest } from './subqueries/metadataLatest'
import { isPublishedMetadataRow } from '@/helpers/isPublishedMetadataRow'
import {
  applyPendingRow,
  getPendingPropertyRows,
  propertyNameVariants,
  type PendingPropertyRow,
} from '@/outbox/pendingValues'

/**
 * Puts each property's pending outbox value over its row (ADR 0019), as an unpublished edit, and adds
 * a row for a property that has a pending value but no row yet.
 */
function withPendingRows(rows: any[], pending: Map<string, PendingPropertyRow>, seedLocalId: string | null | undefined): any[] {
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

  // Pending ops before the stored rows: an op that applies between the two reads is then in one of
  // them. Read the other way round, it would be in neither.
  const pendingFirst = seedLocalId ? await getPendingPropertyRows(seedLocalId) : undefined
  const stored = await appDb
    .with(metadataLatest)
    .select()
    .from(metadataLatest)
    .where(eq(metadataLatest.rowNum, 1))
  const pendingSeedLocalId = seedLocalId ?? stored[0]?.seedLocalId
  const pending = pendingFirst ?? (await getPendingPropertyRows(pendingSeedLocalId))
  const propertiesData = withPendingRows(stored, pending, pendingSeedLocalId)

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
