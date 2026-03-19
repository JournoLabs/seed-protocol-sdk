import { PropertyData } from "@/types"
import { BaseDb } from "@/db/Db/BaseDb"
import { metadata, MetadataType } from "@/seedSchema"
import { or, eq, and, sql } from "drizzle-orm"
import { GetPropertyDataOptions } from "@/types/db"
import {
  getMetadataPropertyNamesForQuery,
  resolveMetadataRecord,
} from "@/helpers/metadataPropertyNames"

export const getPropertyData = async ({
  propertyName,
  seedLocalId,
  seedUid,
}: GetPropertyDataOptions): Promise<PropertyData | undefined> => {
  const appDb = BaseDb.getAppDb()

  const names = getMetadataPropertyNamesForQuery(propertyName)
  const propertyNameWhere =
    names.length > 1 ? or(...names.map((n) => eq(metadata.propertyName, n))) : eq(metadata.propertyName, names[0])

  const whereClauses: any[] = [propertyNameWhere]

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
    .orderBy(
      sql.raw(`COALESCE(attestation_created_at, created_at) DESC`),
    )) as MetadataType[]

  if (!rows || rows.length === 0) {
    return
  }

  const row = resolveMetadataRecord(
    rows as (MetadataType & { refResolvedValue?: string | null; refSeedType?: string })[],
    propertyName
  )

  return row as PropertyData
} 