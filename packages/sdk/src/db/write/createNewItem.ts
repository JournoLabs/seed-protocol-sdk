import { ModelValues } from '@/types'
// Dynamic import to break circular dependency: Model -> BaseItem -> createNewItem -> Model
// import { Model } from '@/Model/Model'
import { resolveNewSeedFields } from './createSeed'
import { resolveMetadataSchemaUid } from './createMetadata'
import { easName } from '@seedprotocol/eas'
import { modelPropertiesToObject } from '@/helpers/model'
import { generateId } from '@/helpers/generateId'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'
import { listRelationEasPropertyName } from '@/helpers/metadataPropertyNames'
import type { CreateItemOp, CreateItemResult } from '@/outbox/itemAppliers'

type CreateNewItemProps = Partial<ModelValues<any>> & {
  modelName: string
  /** schemaFileId of the item's models row; recorded on the seed so the item's model is unambiguous. */
  modelFileId?: string
}

type CreateNewItemReturnType = {
  modelName: string
  seedLocalId: string
  versionLocalId: string
}

/**
 * Writes a new item (ADR 0019): its seed, first version and a row per property go in one outbox op
 * applied in one transaction, so a failure leaves nothing behind. ItemStorage initial values are
 * staged first and moved into the item's files when the op applies.
 */
export const createNewItem = async ({
  modelName,
  modelFileId,
  ...propertyData
}: CreateNewItemProps): Promise<CreateNewItemReturnType> => {
  if (!modelName) {
    throw new Error('A model name is required for createNewItem')
  }

  const seedType = easName(modelName)

  // Dynamic import to break circular dependency
  const modelMod = await import('../../Model/Model')
  const { Model } = modelMod
  const model = await Model.resolveAsync(modelName, { modelFileId })
  const propertySchemas = model?.properties ? modelPropertiesToObject(model.properties) : undefined
  modelFileId ??= model?.id

  // Chosen now: ItemStorage files are named after it before the seed row exists
  const seedLocalId = generateId()

  // Build set of all properties to create metadata for: union of model schema + propertyData
  // This ensures we create metadata for ALL model properties even when creating with no initial values
  // (fixes first-item persistence: loadOrCreateItem needs metadata rows to run createItemPropertyInstances)
  const allPropertyNames = new Set<string>(Object.keys(propertyData))
  if (propertySchemas) {
    for (const name of Object.keys(propertySchemas)) {
      allPropertyNames.add(name)
    }
  }

  const rows: CreateItemOp['rows'] = []
  const stagedPaths: string[] = []
  try {
    for (const propertyName of allPropertyNames) {
      const propertyValue = propertyData[propertyName]
      const propertyRecordSchema = propertySchemas?.[propertyName]
      const isItemStorage = propertyRecordSchema?.storageType === 'ItemStorage'

      // ItemStorage content lives in the property's file (`<seedLocalId><extension>`), as a save puts
      // it; the row records where. Stored verbatim in the row, publish would never upload it.
      if (isItemStorage && propertyValue != null && propertyValue !== '') {
        const stagedPath = BaseFileManager.getFilesPath('staging', generateId())
        await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('staging'))
        await BaseFileManager.saveFile(stagedPath, propertyValue as string | Blob | ArrayBuffer)
        stagedPaths.push(stagedPath)
        const dir = getItemStorageSubdir(propertyRecordSchema.localStorageDir)
        rows.push({
          propertyName,
          propertyRecordSchema,
          itemStorage: {
            stagedPath,
            fileName: getItemStorageLocalFileName(seedLocalId, propertyRecordSchema.filenameSuffix),
            localStorageDir: propertyRecordSchema.localStorageDir || `/${dir}`,
          },
        })
        continue
      }

      // Resolved now: applying runs in a transaction and doesn't wait on EAS
      const schemaUid =
        propertyRecordSchema && !isItemStorage
          ? await resolveMetadataSchemaUid(
              listRelationEasPropertyName(propertyName, propertyRecordSchema) ?? propertyName,
              propertyRecordSchema,
            )
          : undefined
      rows.push({ propertyName, propertyValue, propertyRecordSchema, schemaUid })
    }

    const { appendOutboxOpAndWait, startItemOutbox } = await import('@/outbox')
    startItemOutbox()
    const applied = await appendOutboxOpAndWait<CreateItemResult>({
      seedLocalId,
      kind: 'create',
      value: {
        modelName,
        seed: { type: seedType, modelFileId, fields: await resolveNewSeedFields(seedType) },
        rows,
      } satisfies CreateItemOp,
    })
    if (applied.superseded || !applied.result) {
      throw new Error(`The new ${modelName} item was not written`)
    }
    return { modelName, seedLocalId, versionLocalId: applied.result.versionLocalId }
  } catch (error) {
    // Staged values of a create that never got appended (once appended, the op's discard does it)
    const { deleteFiles } = await import('@/outbox/itemAppliers')
    await deleteFiles(stagedPaths)
    throw error
  }
}
