import { metadata, MetadataType } from '@/seedSchema'
import { and, eq, or, sql } from 'drizzle-orm'
import { getSeedData } from '@/db/read/getSeedData'
import { getVersionData } from '@/db/read/getVersionData'
import { generateId } from '@/helpers'
import { getMetadataPropertyNamesForQuery } from '@/helpers/metadataPropertyNames'
import { METADATA_LATEST_FIRST_ORDER_SQL } from '@/helpers/compareMetadataRowsLatestFirst'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
const logger = debug('seedSdk:write:updateItemPropertyValue')

type UpdateItemPropertyValueResult = {
  localId: string
  schemaUid: string
}

type UpdateItemPropertyValueProps = Partial<MetadataType> & {
  newValue?: string | null
  modelName?: string | null
  dataType?: string
  refValueType?: string
}

type UpdateItemPropertyValue = (props: UpdateItemPropertyValueProps) => Promise<UpdateItemPropertyValueResult | undefined>

export const updateItemPropertyValue: UpdateItemPropertyValue = async ({
  localId: localIdParam,
  propertyName,
  newValue,
  seedUid,
  seedLocalId,
  modelName,
  refSeedType,
  refResolvedValue,
  refResolvedDisplayValue,
  versionLocalId,
  versionUid,
  schemaUid,
  localStorageDir,
  dataType,
  refValueType,
}) => {
  if (!localIdParam && !seedLocalId) {
    logger(
      `[db/write] [updateItemPropertyValue] no propertyLocalId or seedLocalId for property: ${propertyName}`,
    )
    return
  }

  // Every write below binds parameters: store the value as given (no SQL escaping).
  const safeNewValue = newValue

  const appDb = BaseDb.getAppDb()

  // Path 1: When localId is provided, query by local_id first (avoids property name mismatch)
  let rows: (MetadataType & { localId?: string | null })[]
  if (localIdParam && seedLocalId) {
    const localIdRows = await appDb
      .select()
      .from(metadata)
      .where(
        and(
          eq(metadata.localId, localIdParam),
          eq(metadata.seedLocalId, seedLocalId),
        ),
      )
    rows = localIdRows as (MetadataType & { localId?: string | null })[]
    if (rows.length === 0) {
      // Fallback: row may have been created with different property_name variant
      const names = getMetadataPropertyNamesForQuery(propertyName!, dataType, (refValueType ?? refSeedType) ?? undefined)
      const propertyNameWhere =
        names.length > 1
          ? or(...names.map((n) => eq(metadata.propertyName, n)))
          : eq(metadata.propertyName, names[0])
      rows = (await appDb
        .select()
        .from(metadata)
        .where(and(propertyNameWhere, eq(metadata.seedLocalId, seedLocalId)))
        .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))) as (MetadataType & { localId?: string | null })[]
    }
  } else if (localIdParam) {
    const localIdRows = await appDb
      .select()
      .from(metadata)
      .where(eq(metadata.localId, localIdParam))
    rows = localIdRows as (MetadataType & { localId?: string | null })[]
  } else {
    // Path 2: Query by property name variants (align with read path)
    const names = getMetadataPropertyNamesForQuery(propertyName!, dataType, (refValueType ?? refSeedType) ?? undefined)
    const propertyNameWhere =
      names.length > 1
        ? or(...names.map((n) => eq(metadata.propertyName, n)))
        : eq(metadata.propertyName, names[0])
    rows = (await appDb
      .select()
      .from(metadata)
      .where(and(propertyNameWhere, eq(metadata.seedLocalId, seedLocalId!)))
      .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))) as (MetadataType & { localId?: string | null })[]
  }

  if (rows && rows.length > 0) {
    const {
      localId,
      uid,
      propertyName: propertyNameFromDb,
      propertyValue: propertyValueFromDb,
      modelType,
      seedUid,
      seedLocalId: seedLocalIdFromDb,
      versionLocalId,
      versionUid,
      schemaUid,
      easDataType,
      localStorageDir: localStorageDirFromDb,
      refSeedType: refSeedTypeFromDb,
      refResolvedValue: refResolvedValueFromDb,
      refResolvedDisplayValue: refResolvedDisplayValueFromDb,
    } = rows[0]

    if (
      propertyValueFromDb === newValue &&
      modelType === modelName?.toLowerCase() &&
      refSeedTypeFromDb === refSeedType &&
      refResolvedValueFromDb === refResolvedValue
    ) {
      logger(
        `[db/write] [updateItemPropertyValue] value is the same as most recent record for property: ${propertyNameFromDb}`,
      )
      return
    }

    // This means we already have a local-only record so we should just update that one
    if (!uid) {
      if (localId == null) return
      // Use Drizzle update API for proper parameterization (avoids SQL injection from filenames with quotes)
      const updatePayload: Record<string, unknown> = {
        propertyValue: safeNewValue ?? null,
        refSeedType: refSeedType ?? null,
        refResolvedValue: refResolvedValue ?? null,
        refResolvedDisplayValue: refResolvedDisplayValue ?? null,
        updatedAt: Date.now(),
      }
      if (localStorageDir !== undefined) {
        updatePayload.localStorageDir = localStorageDir ?? null
      }
      await appDb
        .update(metadata)
        .set(updatePayload as Partial<typeof metadata.$inferInsert>)
        .where(eq(metadata.localId, localId))

      return
    }

    const seedDataFromDb = seedLocalId ? await getSeedData({ seedLocalId }) : null
    const versionDataFromDb = versionLocalId ? await getVersionData({ localId: versionLocalId }) : null

    // Here we don't have a local-only record so we need to create a new one
    const newLocalId = generateId()

    await appDb.insert(metadata).values({
      localId: newLocalId,
      propertyName: propertyNameFromDb,
      propertyValue: safeNewValue ?? null,
      modelType: modelType || modelName?.toLowerCase() || null,
      seedUid: seedDataFromDb?.uid || null,
      seedLocalId: seedLocalIdFromDb,
      versionLocalId,
      versionUid: versionDataFromDb?.uid || null,
      schemaUid,
      easDataType: easDataType || null,
      refSeedType: refSeedType || null,
      refResolvedValue: refResolvedValue || null,
      refResolvedDisplayValue: refResolvedDisplayValue || null,
      localStorageDir: localStorageDir || null,
      createdAt: Date.now(),
    })

    return {
      localId: newLocalId,
      schemaUid: schemaUid ?? '',
    }
  }

  // Here there are no records for this property on this seed so we should create one

  const newLocalId = generateId()

  if (!seedUid) {
    const seedData = await getSeedData({ seedLocalId: seedLocalId || undefined })
    if (seedData) {
      seedUid = seedData.uid || undefined
    }
  }

  if (!versionUid) {
    const versionData = await getVersionData({ localId: versionLocalId })
    if (versionData) {
      versionUid = versionData.uid
    }
  }

  await appDb.insert(metadata).values({
    localId: newLocalId,
    propertyName,
    propertyValue: safeNewValue ?? null,
    modelType: modelName?.toLowerCase() || '',
    seedUid: seedUid || null,
    seedLocalId: seedLocalId || '',
    versionLocalId: versionLocalId || '',
    versionUid: versionUid || null,
    schemaUid: schemaUid || '',
    refSeedType: refSeedType || null,
    refResolvedValue: refResolvedValue || null,
    refResolvedDisplayValue: refResolvedDisplayValue || null,
    localStorageDir: localStorageDir || null,
    createdAt: Date.now(),
  })

  return {
    localId: newLocalId,
    schemaUid: schemaUid ?? '',
  }

  if (!seedLocalId && propertyName && modelName && newValue) {
    // TODO: Does this ever happen? If so, what should we do?
  }
}
