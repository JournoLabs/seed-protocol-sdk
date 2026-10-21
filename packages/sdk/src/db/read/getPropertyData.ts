import { PropertyData } from "@/types"
import { BaseDb } from "@/db/Db/BaseDb"
import { metadata, MetadataType } from "@/seedSchema"
import { or, eq, and, sql } from "drizzle-orm"
import { GetPropertyDataOptions } from "@/types/db"
import { resolveMetadataRecord } from "@/helpers/metadataPropertyNames"
import { METADATA_LATEST_FIRST_ORDER_SQL } from "@/helpers/compareMetadataRowsLatestFirst"
import { matchMetadataProperty, metadataRowsOfProperty } from "@/db/read/metadataProperty"

/**
 * The row a property's value is read from. The property's rows are the ones linked to it by
 * property_id, whatever name they are stored under, plus rows with none stored under one of its
 * names (decision D4).
 */
export const getPropertyData = async ({
  propertyName,
  seedLocalId,
  seedUid,
  modelName,
  propertyId,
}: GetPropertyDataOptions): Promise<PropertyData | undefined> => {
  const appDb = BaseDb.getAppDb()

  const property = await matchMetadataProperty({ propertyId, propertyName, modelName, seedLocalId, seedUid }, appDb)

  const whereClauses: any[] = [metadataRowsOfProperty(property)]

  if (seedLocalId && seedUid) {
    whereClauses.push(
      or(
        eq(metadata.seedLocalId, seedLocalId),
        eq(metadata.seedUid, seedUid),
      ),
    )
  } else if (seedLocalId) {
    whereClauses.push(eq(metadata.seedLocalId, seedLocalId))
  } else if (seedUid) {
    whereClauses.push(eq(metadata.seedUid, seedUid))
  }

  const rows = (await appDb
    .select()
    .from(metadata)
    .where(and(...whereClauses))
    .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))) as MetadataType[]

  if (!rows || rows.length === 0) {
    return
  }

  const row = resolveMetadataRecord(
    rows as (MetadataType & { refResolvedValue?: string | null; refSeedType?: string })[],
    propertyName
  )

  return row as PropertyData
}
