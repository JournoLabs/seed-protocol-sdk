import { metadata, MetadataType } from '@/seedSchema'
import { eq, max } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'

export const getRelationValueData = async (
  propertyValue: any,
): Promise<MetadataType | undefined> => {
  const appDb = BaseDb.getAppDb()

  const rows = (await appDb
    .select({
      propertyValue: metadata.propertyValue,
      attestationCreatedAt: max(metadata.attestationCreatedAt),
      refResolvedDisplayValue: metadata.refResolvedDisplayValue,
      refResolvedValue: metadata.refResolvedValue,
      refSeedType: metadata.refSeedType,
      easDataType: metadata.easDataType,
    })
    .from(metadata)
    .where(eq(metadata.propertyValue, propertyValue))) as MetadataType[]

  if (!rows || rows.length === 0) {
    return
  }

  return rows[0]
} 