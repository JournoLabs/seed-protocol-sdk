import { eq, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { isPlaceholderUid } from '@seedprotocol/eas'
import { METADATA_LATEST_FIRST_ORDER_SQL } from '@/helpers/compareMetadataRowsLatestFirst'
import type { IItem } from '@/interfaces'

/**
 * Points each property whose context holds a published row's uid at the property's newest row when
 * that row is a draft, clearing the uid. Publish skips a property with a uid in patch mode, so an
 * edit the context missed (another tab's write, a metadata update the live query dropped while the
 * property was saving) would never attest. The context takes the row's value too, the way the
 * change feed sets it, so the payload attests the value of the row it names (audit 1.1).
 */
export const reconcilePropertyDraftRows = async (item: IItem<any>): Promise<void> => {
  const stale = item.properties.filter((property) => property.uid && property.localId)
  const seedLocalId = item.seedLocalId
  if (stale.length === 0 || !seedLocalId) return
  const appDb = BaseDb.getAppDb()
  if (!appDb) return

  const rows = await appDb
    .select({
      localId: metadata.localId,
      uid: metadata.uid,
      propertyName: metadata.propertyName,
      propertyValue: metadata.propertyValue,
      refResolvedValue: metadata.refResolvedValue,
    })
    .from(metadata)
    .where(eq(metadata.seedLocalId, seedLocalId))
    .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))

  for (const property of stale) {
    // The context's row gives the stored property name (relations and lists store a variant).
    const current = rows.find((row: { localId: string | null }) => row.localId === property.localId)
    if (!current?.propertyName) continue
    const newest = rows.find((row: { propertyName: string | null }) => row.propertyName === current.propertyName)
    if (!newest?.localId || newest.localId === current.localId || !isPlaceholderUid(newest.uid)) continue
    // As in the change feed: an ItemStorage row pointing at its file holds no content to show.
    const contentInFile =
      property.propertyDef?.storageType === 'ItemStorage' &&
      newest.propertyValue == null &&
      !!newest.refResolvedValue
    property.getService().send({
      type: 'updateContext',
      localId: newest.localId,
      uid: undefined,
      propertyValue: newest.propertyValue,
      ...(contentInFile ? {} : { renderValue: newest.propertyValue }),
      refResolvedValue: newest.refResolvedValue || undefined,
    })
  }
}
