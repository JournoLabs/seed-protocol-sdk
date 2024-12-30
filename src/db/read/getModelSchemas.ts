import { getModels } from '@/stores/modelClass'
import { GetSchemasQuery, Schema } from '@/graphql/gql/graphql'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, modelUids } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import pluralize from 'pluralize'
import { toSnakeCase } from '@/helpers'
import { GET_SCHEMAS } from '@/Item/queries'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'


type GetModelSchemasReturn = {
  modelSchemas: GetSchemasQuery
  schemaStringToModelRecord: Map<string, Schema>
  modelRecords: Record<string, unknown>
}

type GetModelSchemas = () => Promise<GetModelSchemasReturn>

export const getModelSchemas: GetModelSchemas = async () => {
  const models = getModels()
  const modelRecords = [] as Record<string, unknown>[]

  const schemaStringToModelRecord = new Map<string, Schema>()

  const appDb = BaseDb.getAppDb()

  const OR: Record<string, unknown>[] = []

  for (const [modelName, _] of Object.entries(models)) {
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

    const foundModel: Schema = { ...foundModelQuery[0] }

    if (!foundModel) {
      console.error(
        `[item/events] [syncDbWithEas] model ${modelName} not found in SDK DB`,
      )
      return
    }

    foundModel.tableName = pluralize(foundModel.name).toLowerCase()

    modelRecords!.push(foundModel)

    if (modelName === 'Seed' || modelName === 'Version') {
      continue
    }

    const schemaString = `bytes32 ${toSnakeCase(modelName)}`

    OR.push({
      schema: {
        equals: `bytes32 ${toSnakeCase(modelName)}`,
      },
    })

    schemaStringToModelRecord.set(schemaString, foundModel)
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const modelSchemas = await queryClient.fetchQuery({
    queryKey: [`getSchemasAllModels`],
    queryFn: async () =>
      easClient.request(GET_SCHEMAS, {
        where: {
          OR,
        },
      }),
  })

  return {
    modelSchemas,
    schemaStringToModelRecord,
    modelRecords,
  }
}
