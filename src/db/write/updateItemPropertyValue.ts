import { escapeSqliteString } from '@/helpers/db'
import { getAppDb, runQueryForStatement } from '@/browser'
import { metadata, MetadataType } from '@/seedSchema'
import { and, eq, sql } from 'drizzle-orm'
import { getSeedData } from '@/db/read/getSeedData'
import { getVersionData } from '@/db/read/getVersionData'
import { generateId } from '@/helpers'
import debug from 'debug'
import { eventEmitter } from '@/eventBus'

const logger = debug('app:write:updateItemPropertyValue')

const sendItemUpdateEvent = ({ modelName, seedLocalId, seedUid }) => {
  if (!modelName || (!seedLocalId && !seedUid)) {
    return
  }
  eventEmitter.emit(`item.${modelName}.${seedUid || seedLocalId}.update`)
}

type UpdateItemPropertyValue = (props: Partial<MetadataType>) => Promise<void>

export const updateItemPropertyValue: UpdateItemPropertyValue = async ({
  localId,
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
}) => {
  if (!localId && !seedLocalId) {
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

  const appDb = getAppDb()

  const rows = await appDb
    .select()
    .from(metadata)
    .where(
      and(
        eq(metadata.propertyName, propertyName!),
        eq(metadata.seedLocalId, seedLocalId!),
      ),
    )
    .orderBy(sql.raw('COALESCE(attestation_created_at, created_at) DESC'))

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
      const updatePropertyStatement = `UPDATE metadata
                                       SET property_value             = '${safeNewValue}',
                                           ref_seed_type              = ${refSeedType ? `'${refSeedType}'` : 'NULL'},
                                           ref_resolved_value         = ${refResolvedValue ? `'${refResolvedValue}'` : 'NULL'},
                                           ref_resolved_display_value = ${refResolvedDisplayValue ? `'${refResolvedDisplayValue}'` : 'NULL'},
                                           updated_at                 = ${Date.now()}
                                       WHERE local_id = '${localId}';`

      await runQueryForStatement(updatePropertyStatement)

      sendItemUpdateEvent({ modelName, seedLocalId, seedUid })

      return
    }

    const seedDataFromDb = await getSeedData({ seedLocalId })
    const versionDataFromDb = await getVersionData({ localId: versionLocalId })

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

    await runQueryForStatement(newPropertyStatement)

    sendItemUpdateEvent({ modelName, seedLocalId, seedUid })

    return
  }

  // Here there are no records for this property on this seed so we should create one

  const newLocalId = generateId()

  if (!seedUid) {
    const seedData = await getSeedData({ seedLocalId })
    if (seedData) {
      seedUid = seedData.uid
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
                                        '${modelName?.toLowerCase()}',
                                        ${seedUid ? `'${seedUid}'` : 'NULL'},
                                        '${seedLocalId}',
                                        '${versionLocalId}',
                                        ${versionUid ? `'${versionUid}'` : 'NULL'},
                                        '${schemaUid}',
                                        ${refSeedType ? `'${refSeedType}'` : 'NULL'},
                                        ${refResolvedValue ? `'${refResolvedValue}'` : 'NULL'},
                                        ${refResolvedDisplayValue ? `'${refResolvedDisplayValue}'` : 'NULL'},
                                        ${localStorageDir ? `'${localStorageDir}'` : 'NULL'},
                                        ${Date.now()});`

  await runQueryForStatement(newPropertyStatement)

  sendItemUpdateEvent({ modelName, seedLocalId, seedUid })

  if (!seedLocalId && propertyName && modelName && newValue) {
    // TODO: Does this ever happen? If so, what should we do?
  }
}
