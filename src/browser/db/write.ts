import { generateId } from '@/shared/helpers'
import { ModelValues } from '@/types'
import debug from 'debug'
import { getAppDb } from '@/browser/db/sqlWasmClient'
import { MetadataType, seeds } from '@/shared/seedSchema'
import { createVersion } from '@/browser/db/write/createVersion'
import { createMetadata } from '@/browser/db/write/createMetadata'
import { getModel } from '@/browser/stores/modelClass'
import { getSchemaUidForModel } from '@/browser/db/read/getSchemaUidForModel'

const logger = debug('app:write')

type CreateSeedProps = {
  type: string
  seedUid?: string
}

type CreateSeed = (props: CreateSeedProps) => Promise<string>

export const createSeed: CreateSeed = async ({ type, seedUid }) => {
  const schemaUid = await getSchemaUidForModel(type)

  if (!schemaUid) {
    throw new Error(`No schema found for model type: ${type}`)
  }

  const appDb = getAppDb()

  const newSeedLocalId = generateId()

  await appDb.insert(seeds).values({
    localId: newSeedLocalId,
    type,
    uid: seedUid,
    createdAt: Date.now(),
    schemaUid,
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
