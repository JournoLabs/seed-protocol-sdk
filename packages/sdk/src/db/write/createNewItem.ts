import { ModelValues } from '@/types'
// Dynamic import to break circular dependency: Model -> BaseItem -> createNewItem -> Model
// import { Model } from '@/Model/Model'
import { createSeed } from './createSeed'
import { createVersion } from './createVersion'
import { createMetadata } from './createMetadata'
import { toSnakeCase } from 'drizzle-orm/casing'
import { modelPropertiesToObject } from '@/helpers/model'

type CreateNewItemProps = Partial<ModelValues<any>> & {
  modelName: string
}

type CreateNewItemReturnType = {
  modelName: string
  seedLocalId: string
  versionLocalId: string
}

export const createNewItem = async ({
  modelName,
  ...propertyData
}: CreateNewItemProps): Promise<CreateNewItemReturnType> => {
  if (!modelName) {
    throw new Error('A model name is required for createNewItem')
  }

  const seedType = toSnakeCase(modelName)

  const newSeedId = await createSeed({ type: seedType })

  const newVersionId = await createVersion({ seedLocalId: newSeedId, seedType: toSnakeCase(modelName) })

  // Dynamic import to break circular dependency
  const modelMod = await import('../../Model/Model')
  const { Model } = modelMod
  const model = await Model.getByNameAsync(modelName)
  const propertySchemas = model?.properties ? modelPropertiesToObject(model.properties) : undefined

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

    await createMetadata(
      {
        seedLocalId: newSeedId,
        versionLocalId: newVersionId,
        propertyName,
        propertyValue,
        modelName,
      } as Parameters<typeof createMetadata>[0],
      propertyRecordSchema,
      { skipValidation: true },
    )
  }

  return {
    modelName,
    seedLocalId: newSeedId,
    versionLocalId: newVersionId,
  }
} 