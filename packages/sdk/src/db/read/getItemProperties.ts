import { GetItemProperties, PropertyData } from '@/types'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { getMetadataLatest } from './subqueries/metadataLatest'
import { isPublishedMetadataRow } from '@/helpers/isPublishedMetadataRow'


export const getItemProperties: GetItemProperties = async ({
  seedLocalId,
  seedUid,
  edited,
}) => {
  const appDb = BaseDb.getAppDb()

  const metadataLatest = getMetadataLatest({seedLocalId, seedUid})

  const propertiesData = await appDb
    .with(metadataLatest)
    .select()
    .from(metadataLatest)
    .where(eq(metadataLatest.rowNum, 1))

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
