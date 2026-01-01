import { ModelValues } from '@/types'
import { Model } from '@/Model/Model'
import { createSeed } from './createSeed'
import { createVersion } from './createVersion'
import { createMetadata } from './createMetadata'
import { toSnakeCase } from 'drizzle-orm/casing'
import { eventEmitter } from '@/eventBus'

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

  const model = await Model.getByNameAsync(modelName)
  const propertySchemas = model?.schema

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
      } as Parameters<typeof createMetadata>[0],
      propertyRecordSchema,
    )
  }

  eventEmitter.emit('item.requestAll', { modelName })

  return {
    modelName,
    seedLocalId: newSeedId,
    versionLocalId: newVersionId,
  }
} 