import { GET_SCHEMAS } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { cachedSchemaLookup, getSchemaUidForModelFromCache, setSchemaUidForModel } from '@/stores/eas'
import { eq } from 'drizzle-orm'
import { models as modelsTable, modelUids } from '@/seedSchema'

export const getEasSchemaUidForModel = async (
  modelName: string,
): Promise<string | null | undefined> => {
  const cached = getSchemaUidForModelFromCache(modelName)
  if (cached) return cached

  const modeType = modelName.toLowerCase()

  // Misses are cached too (most local models have no EAS schema); the DB fallback below still runs.
  const easSchemaUid = await cachedSchemaLookup(`model:${modeType}`, async () => {
    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    const modelSchemaQuery = await queryClient.fetchQuery({
      queryKey: [`getPropertySchema${modelName}`],
      queryFn: async () =>
        easClient.request(GET_SCHEMAS, {
          where: {
            schemaNames: {
              some: {
                name: {
                  equals: modeType,
                },
              },
            },
          },
        }),
    })

    return modelSchemaQuery.schemas[0]?.id
  })
  if (easSchemaUid) {
    setSchemaUidForModel({ modelName, schemaUid: easSchemaUid })
    return easSchemaUid
  }

  // Fallback: use schema UID from local DB when EAS has no schema (e.g. test schemas)
  const appDb = BaseDb.getAppDb()
  if (appDb) {
    const row = await appDb
      .select({ uid: modelUids.uid })
      .from(modelsTable)
      .innerJoin(modelUids, eq(modelsTable.id, modelUids.modelId))
      .where(eq(modelsTable.name, modelName))
      .limit(1)
    const uid = row[0]?.uid
    if (uid) {
      setSchemaUidForModel({ modelName, schemaUid: uid })
      return uid
    }
  }

  return undefined
}
