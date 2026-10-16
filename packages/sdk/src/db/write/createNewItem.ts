import { ModelValues } from '@/types'
// Dynamic import to break circular dependency: Model -> BaseItem -> createNewItem -> Model
// import { Model } from '@/Model/Model'
import { createSeed } from './createSeed'
import { createVersion } from './createVersion'
import { createMetadata } from './createMetadata'
import { easName } from '@seedprotocol/eas'
import { modelPropertiesToObject } from '@/helpers/model'
import {
  getItemStorageFilePath,
  withItemStorageFileLock,
  writeItemStorageFile,
} from '@/helpers/itemStorageFile'

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

  const newSeedId = await createSeed({ type: seedType, modelFileId })

  const newVersionId = await createVersion({ seedLocalId: newSeedId, seedType: easName(modelName) })

  // Build set of all properties to create metadata for: union of model schema + propertyData
  // This ensures we create metadata for ALL model properties even when creating with no initial values
  // (fixes first-item persistence: loadOrCreateItem needs metadata rows to run createItemPropertyInstances)
  const allPropertyNames = new Set<string>(Object.keys(propertyData))
  if (propertySchemas) {
    for (const name of Object.keys(propertySchemas)) {
      allPropertyNames.add(name)
    }
  }

  for (const propertyName of allPropertyNames) {
    const propertyValue = propertyData[propertyName]
    const propertyRecordSchema = propertySchemas?.[propertyName]

    // ItemStorage content lives in the property's file (`<seedLocalId><extension>`), as a save puts
    // it; the row records where. Stored verbatim in the row, publish would never upload it.
    const isItemStorageValue =
      propertyRecordSchema?.storageType === 'ItemStorage' &&
      propertyValue != null &&
      propertyValue !== ''
    const insertRow = (
      storageFields?: { refResolvedValue: string; localStorageDir: string; refValueType: string },
    ) =>
      createMetadata(
        {
          seedLocalId: newSeedId,
          versionLocalId: newVersionId,
          propertyName,
          propertyValue: storageFields ? undefined : propertyValue,
          ...storageFields,
          modelName,
        } as Parameters<typeof createMetadata>[0],
        propertyRecordSchema,
        { skipValidation: true, modelFileId },
      )

    if (!isItemStorageValue) {
      await insertRow()
      continue
    }

    // File and row under the file's lock, like every writer of a local draft's file (see
    // withItemStorageFileLock). The seed is new, so nothing else should be writing it yet.
    const target = {
      seedId: newSeedId,
      localStorageDir: propertyRecordSchema.localStorageDir,
      filenameSuffix: propertyRecordSchema.filenameSuffix,
    }
    await withItemStorageFileLock(getItemStorageFilePath(target), async () => {
      const written = await writeItemStorageFile(target, propertyValue as string | Blob | ArrayBuffer)
      await insertRow({
        refResolvedValue: written.fileName,
        localStorageDir: written.localStorageDir,
        refValueType: 'file',
      })
    })
  }

  return {
    modelName,
    seedLocalId: newSeedId,
    versionLocalId: newVersionId,
  }
} 