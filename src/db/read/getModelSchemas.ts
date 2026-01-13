// Dynamic import to break circular dependency: Model -> BaseItem -> ... -> getModelSchemas -> Model
// import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, modelUids } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import pluralize from 'pluralize'
import { toSnakeCase } from '@/helpers'

type ModelRecord = {
  id: number
  name: string
  uid: string | null
  tableName?: string
}

const schemaStringToModelRecord = new Map<string, ModelRecord>()

type GetModelSchemasReturn = {
  schemaStringToModelRecord: Map<string, ModelRecord>
  modelRecords: ModelRecord[]
}

type GetModelSchemas = () => Promise<GetModelSchemasReturn>

export const getModelSchemas: GetModelSchemas = async () => {
  // Dynamic import to break circular dependency
  const { Model } = await import('@/Model/Model')
  const allModels = Model.getAll()
  const modelRecords: ModelRecord[] = []

  const appDb = BaseDb.getAppDb()

  for (const model of allModels) {
    const modelName = model.modelName
    if (!modelName) continue
    const foundModelQuery = await appDb
      .select({
        id: modelsTable.id,
        name: modelsTable.name,
        uid: modelUids.uid,
      })
      .from(modelsTable)
      .leftJoin(modelUids, eq(modelsTable.id, modelUids.modelId))
      .where(eq(modelsTable.name, modelName))
      .limit(1)

    if (!foundModelQuery[0]) {
      console.error(
        `[item/events] [syncDbWithEas] model ${modelName} not found in SDK DB`,
      )
      continue
    }

    const foundModel: ModelRecord = {
      id: foundModelQuery[0].id,
      name: foundModelQuery[0].name,
      uid: foundModelQuery[0].uid,
      tableName: pluralize(foundModelQuery[0].name).toLowerCase(),
    }

    modelRecords.push(foundModel)

    if (modelName === 'Seed') {
      continue
    }

    const schemaString = `bytes32 ${toSnakeCase(modelName)}`

    schemaStringToModelRecord.set(schemaString, foundModel)
  }

  return {
    schemaStringToModelRecord,
    modelRecords,
  }
}
