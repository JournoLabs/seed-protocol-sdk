import { sql } from 'drizzle-orm'
import { generateId } from '@/shared/helpers'
import { ModelValues } from '@/types'
import { escapeSqliteString } from '@/shared/helpers/db'
import { getSeedData } from '@/browser/db/read/getSeedData'
import { getVersionData } from '@/browser/db/read/getVersionData'
import debug from 'debug'
import { eventEmitter } from '@/eventBus'
import { getAppDb, runQueryForStatement } from '@/browser/db/sqlWasmClient'
import { appState, MetadataType, seeds } from '@/shared/seedSchema'
import { createVersion } from '@/browser/db/write/createVersion'
import { createMetadata } from '@/browser/db/write/createMetadata'
import { getModel } from '@/browser/stores/modelClass'

const logger = debug('app:write')

type CreateSeedProps = {
  type: string
  seedUid?: string
}

type CreateSeed = (props: CreateSeedProps) => Promise<string>

const sendItemUpdateEvent = ({ modelName, seedLocalId, seedUid }) => {
  if (!modelName || (!seedLocalId && !seedUid)) {
    return
  }
  eventEmitter.emit(`item.${modelName}.${seedUid || seedLocalId}.update`)
}

export const createSeed: CreateSeed = async ({ type, seedUid }) => {
  const appDb = getAppDb()

  const newSeedLocalId = generateId()

  await appDb.insert(seeds).values({
    localId: newSeedLocalId,
    type,
    uid: seedUid,
    createdAt: Date.now(),
  })

  return newSeedLocalId
}

type CreateMetadataForExistingRecordProps = {
  existingRecord: MetadataType
  propertyName: string
  propertyValue: any
}

type CreateMetadataForExistingRecord = (
  props: CreateMetadataForExistingRecordProps,
) => Promise<void>

/**
 * Create a new metadata record from an existing record.
 * @param existingRecord
 * @param propertyName
 * @param propertyValue
 */
export const createNewMetadataFromExistingRecord: CreateMetadataForExistingRecord =
  async ({ existingRecord, propertyName, propertyValue }) => {
    const appDb = getAppDb()

    const newLocalId = generateId()
    await appDb.run(
      sql.raw(
        `INSERT INTO metadata (local_id, seed_local_id, seed_uid, property_name, property_value, attestation_created_at,
                               schema_uid, model_type, version_local_id, version_uid, eas_data_type, ref_value_type,
                               ref_schema_uid, ref_seed_type, ref_resolved_value, ref_resolved_display_value,
                               attestation_raw)
         VALUES ('${newLocalId}', '${existingRecord.seedLocalId}',
                 '${existingRecord.seedUid}' '${propertyName}', '${propertyValue}',
                 '${existingRecord.attestationCreatedAt}', '${existingRecord.schemaUid}',
                 '${existingRecord.modelType}',
                 '${existingRecord.versionLocalId}', '${existingRecord.versionUid}',
                 '${existingRecord.easDataType}', '${existingRecord.refValueType}',
                 '${existingRecord.refSchemaUid}', '${existingRecord.refSeedType}',
                 '${existingRecord.refResolvedValue}', '${existingRecord.refResolvedDisplayValue}',
                 '${existingRecord.attestationRaw}');
        `,
      ),
    )
  }

export const updateMetadataValue = async (
  localId: string,
  propertyValue: any,
) => {
  const appDb = getAppDb()

  await appDb.run(
    sql.raw(
      `UPDATE metadata
       SET property_value = '${propertyValue}'
       WHERE local_id = '${localId}';
      `,
    ),
  )
}

type CreateNewItemProps = Partial<ModelValues<any>> & {
  modelName: string
}

type CreateNewItemReturnType = {
  seedLocalId: string
  versionLocalId: string
}

type CreateNewItem = (
  props: CreateNewItemProps,
) => Promise<CreateNewItemReturnType>

export const createNewItem: CreateNewItem = async ({
  modelName,
  ...propertyData
}) => {
  if (!modelName) {
    throw new Error('A model name is required for createNewItem')
  }

  const appDb = getAppDb()

  const seedType = modelName.toLowerCase()

  const newSeedId = await createSeed({ type: seedType })

  const newVersionId = await createVersion({ seedLocalId: newSeedId })

  const propertySchemas = getModel(modelName)?.schema

  for (const [propertyName, propertyValue] of Object.entries(propertyData)) {
    let propertyRecordSchema

    if (propertySchemas && propertySchemas[propertyName]) {
      propertyRecordSchema = propertySchemas[propertyName]
    }

    await createMetadata(
      {
        seedLocalId: newSeedId,
        versionLocalId: newVersionId,
        propertyName,
        propertyValue,
        modelName,
      },
      propertyRecordSchema,
    )
    // await appDb.run(
    //   sql.raw(
    //     `INSERT INTO metadata (seed_local_id, version_local_id, property_name, property_value, model_type, created_at,
    //                            attestation_created_at)
    //      VALUES ('${newSeedId}', '${newVersionId}', '${propertyName}', '${propertyValue}', '${seedType}', ${Date.now()},
    //              ${Date.now()});`,
    //   ),
    // )
  }

  // eventEmitter.emit(`item.requestAll`, { modelName })

  return {
    modelName,
    seedLocalId: newSeedId,
    versionLocalId: newVersionId,
  }
}

type UpdateItemPropertyValueProps = {
  propertyLocalId?: string
  propertyName?: string
  newValue: any
  seedLocalId?: string
  seedUid?: string
  modelName?: string
  refResolvedValue?: string
  refResolvedDisplayValue?: string
  refSeedType?: string
  versionLocalId?: string
  versionUid?: string
  schemaUid?: string
}

type UpdateItemPropertyValue = (
  props: UpdateItemPropertyValueProps,
) => Promise<void>

export const updateItemPropertyValue: UpdateItemPropertyValue = async ({
  propertyLocalId,
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
}) => {
  if (!propertyLocalId && !seedLocalId) {
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

  const mostRecentRecordStatement = `SELECT local_id,
                                            uid,
                                            property_name,
                                            property_value,
                                            model_type,
                                            seed_uid,
                                            seed_local_id,
                                            version_local_id,
                                            version_uid,
                                            schema_uid,
                                            eas_data_type
                                     FROM metadata
                                     WHERE property_name = '${propertyName}'
                                       AND seed_local_id = '${seedLocalId}'
                                     ORDER BY COALESCE(attestation_created_at, created_at) DESC;`

  const { rows } = await runQueryForStatement(mostRecentRecordStatement)

  if (rows && rows.length > 0) {
    const mostRecentRecord = rows[0]
    const localId = mostRecentRecord[0]
    const uid = mostRecentRecord[1]
    const propertyNameFromDb = mostRecentRecord[2]
    const propertyValueFromDb = mostRecentRecord[3]
    const modelType = mostRecentRecord[4]
    const seedUid = mostRecentRecord[5]
    const seedLocalIdFromDb = mostRecentRecord[6]
    const versionLocalId = mostRecentRecord[7]
    const versionUid = mostRecentRecord[8]
    const schemaUid = mostRecentRecord[9]
    const easDataType = mostRecentRecord[10]

    if (propertyValueFromDb === newValue) {
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
    const versionDataFromDb = await getVersionData({ versionLocalId })

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
                                                        created_at)
                                  VALUES ('${newLocalId}',
                                          '${propertyNameFromDb}',
                                          '${safeNewValue}',
                                          '${modelType}',
                                          ${seedDataFromDb?.uid ? `'${seedDataFromDb.uid}'` : 'NULL'},
                                          '${seedLocalIdFromDb}',
                                          '${versionLocalId}',
                                          ${versionDataFromDb?.uid ? `'${versionDataFromDb.uid}'` : 'NULL'},
                                          '${schemaUid}',
                                          ${easDataType ? `'${easDataType}'` : 'NULL'},
                                          ${refSeedType ? `'${refSeedType}'` : 'NULL'},
                                          ${refResolvedValue ? `'${refResolvedValue}'` : 'NULL'},
                                          ${refResolvedDisplayValue ? `'${refResolvedDisplayValue}'` : 'NULL'},
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
    const versionData = await getVersionData({ versionLocalId })
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
                                        ${Date.now()});`

  await runQueryForStatement(newPropertyStatement)

  sendItemUpdateEvent({ modelName, seedLocalId, seedUid })

  if (!seedLocalId && propertyName && modelName && newValue) {
    // TODO: Does this ever happen? If so, what should we do?
  }
}
export const writeAppState = async (key: string, value: string) => {
  const appDb = getAppDb()

  await appDb
    .insert(appState)
    .values({
      key,
      value,
    })
    .onConflictDoUpdate({
      target: appState.key,
      set: {
        value,
      },
    })
}
