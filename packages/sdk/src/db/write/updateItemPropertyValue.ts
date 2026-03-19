import { escapeSqliteString } from '@/helpers/db'
import { metadata, MetadataType } from '@/seedSchema'
import { and, eq, or, sql } from 'drizzle-orm'
import { getSeedData } from '@/db/read/getSeedData'
import { getVersionData } from '@/db/read/getVersionData'
import { generateId } from '@/helpers'
import { getMetadataPropertyNamesForQuery } from '@/helpers/metadataPropertyNames'
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

  let safeNewValue = newValue

  if (
    typeof newValue === 'string' &&
    !refResolvedDisplayValue &&
    !refResolvedValue
  ) {
    safeNewValue = escapeSqliteString(newValue)
  }

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
        .orderBy(sql.raw('COALESCE(attestation_created_at, created_at) DESC'))) as (MetadataType & { localId?: string | null })[]
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
      .orderBy(sql.raw('COALESCE(attestation_created_at, created_at) DESC'))) as (MetadataType & { localId?: string | null })[]
  }

  // const mostRecentRecordStatement = `SELECT local_id,
  //                                           uid,
  //                                           property_name,
  //                                           property_value,
  //                                           model_type,
  //                                           seed_uid,
  //                                           seed_local_id,
  //                                           version_local_id,
  //                                           version_uid,
  //                                           schema_uid,
  //                                           eas_data_type
  //                                    FROM metadata
  //                                    WHERE property_name = '${propertyName}'
  //                                      AND seed_local_id = '${seedLocalId}'
  //                                    ORDER BY COALESCE(attestation_created_at, created_at) DESC;`
  //
  // const { rows } = await runQueryForStatement(mostRecentRecordStatement)

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

    const newPropertyStatement = `INSERT INTO metadata (local_id,
                                                        property_name,
                                                        property_value,
                                                        model_type,
                                                        seed_uid,
                                                        seed_local_id,
                                                        version_local_id,
                                                        version_uid,
                                                        schema_uid,
                                                        eas_data_type,
                                                        ref_seed_type,
                                                        ref_resolved_value,
                                                        ref_resolved_display_value,
                                                        local_storage_dir,
                                                        created_at)
                                  VALUES ('${newLocalId}',
                                          '${propertyNameFromDb}',
                                          '${safeNewValue}',
                                          '${modelType || modelName?.toLowerCase()}',
                                          ${seedDataFromDb?.uid ? `'${seedDataFromDb.uid}'` : 'NULL'},
                                          '${seedLocalIdFromDb}',
                                          '${versionLocalId}',
                                          ${versionDataFromDb?.uid ? `'${versionDataFromDb.uid}'` : 'NULL'},
                                          '${schemaUid}',
                                          ${easDataType ? `'${easDataType}'` : 'NULL'},
                                          ${refSeedType ? `'${refSeedType}'` : 'NULL'},
                                          ${refResolvedValue ? `'${refResolvedValue}'` : 'NULL'},
                                          ${refResolvedDisplayValue ? `'${refResolvedDisplayValue}'` : 'NULL'},
                                          ${localStorageDir ? `'${localStorageDir}'` : 'NULL'},
                                          ${Date.now()});`

    await appDb.run(sql.raw(newPropertyStatement))

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

  const newPropertyStatement = `INSERT INTO metadata (local_id,
                                                      property_name,
                                                      property_value,
                                                      model_type,
                                                      seed_uid,
                                                      seed_local_id,
                                                      version_local_id,
                                                      version_uid,
                                                      schema_uid,
                                                      ref_seed_type,
                                                      ref_resolved_value,
                                                      ref_resolved_display_value,
                                                      local_storage_dir,
                                                      created_at)
                                VALUES ('${newLocalId}',
                                        '${propertyName}',
                                        '${safeNewValue}',
                                        '${modelName?.toLowerCase() || ''}',
                                        ${seedUid ? `'${seedUid}'` : 'NULL'},
                                        '${seedLocalId || ''}',
                                        '${versionLocalId || ''}',
                                        ${versionUid ? `'${versionUid}'` : 'NULL'},
                                        '${schemaUid || ''}',
                                        ${refSeedType ? `'${refSeedType}'` : 'NULL'},
                                        ${refResolvedValue ? `'${refResolvedValue}'` : 'NULL'},
                                        ${refResolvedDisplayValue ? `'${refResolvedDisplayValue}'` : 'NULL'},
                                        ${localStorageDir ? `'${localStorageDir}'` : 'NULL'},
                                        ${Date.now()});`

    await appDb.run(sql.raw(newPropertyStatement))

  return {
    localId: newLocalId,
    schemaUid: schemaUid ?? '',
  }

  if (!seedLocalId && propertyName && modelName && newValue) {
    // TODO: Does this ever happen? If so, what should we do?
  }
}
