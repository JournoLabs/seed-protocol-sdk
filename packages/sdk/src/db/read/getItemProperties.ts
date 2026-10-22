import { GetItemProperties, PropertyData } from '@/types'
import { isPublishedMetadataRow } from '@/helpers/isPublishedMetadataRow'
import { currentPropertyRows } from '@/db/read/currentPropertyRow'

/**
 * Each of the seed's properties at its current row (currentPropertyRows): a pending outbox value
 * counts as an unpublished edit (ADR 0019), and a property with a pending value but no row yet is
 * listed too.
 */
export const getItemProperties: GetItemProperties = async ({
  seedLocalId,
  seedUid,
  edited,
}) => {
  const propertiesData = await currentPropertyRows({ seedLocalId, seedUid })

  // `edited` picks properties by their current value (the row readers show): true = a local edit
  // not yet attested, false = published. Same test as getPublishPendingDiff.
  const selected =
    typeof edited === 'undefined'
      ? propertiesData
      : propertiesData.filter((data) => isPublishedMetadataRow(data) !== edited)

  return selected.map(({ overlaid: _overlaid, stagedPath: _stagedPath, pendingText: _pendingText, ...data }: any) => ({
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
