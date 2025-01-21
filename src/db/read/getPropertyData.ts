import { PropertyData } from "@/types"
import { BaseDb } from "@/db/Db/BaseDb"
import { metadata, MetadataType } from "@/seedSchema"
import { or, eq, and, sql } from "drizzle-orm"
import { startCase } from "lodash-es"
import { GetPropertyDataOptions } from "@/types/db"


export const getPropertyData = async ({
  propertyName,
  seedLocalId,
  seedUid,
}: GetPropertyDataOptions): Promise<PropertyData | undefined> => {
  const appDb = BaseDb.getAppDb()

  const whereClauses: any[] = [
    or(
      eq(metadata.propertyName, propertyName),
      eq(metadata.propertyName, propertyName + 'Id'),
      eq(metadata.propertyName, propertyName + 'Ids'),
    ),
  ]

  if (seedLocalId) {
    whereClauses.push(eq(metadata.seedLocalId, seedLocalId))
  }

  if (seedUid) {
    whereClauses.push(eq(metadata.seedUid, seedUid))
  }

  const rows = (await appDb
    .select()
    .from(metadata)
    .where(and(...whereClauses))
    .orderBy(
      sql.raw(`COALESCE(attestation_created_at, created_at) DESC`),
    )) as MetadataType[]

  if (!rows || rows.length === 0) {
    return
  }

  const row = rows[0]

  return {
    ...row,
    modelName: startCase(row.modelType),
  }
} 