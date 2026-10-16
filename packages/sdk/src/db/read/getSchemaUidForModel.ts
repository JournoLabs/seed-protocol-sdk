import { GET_SCHEMAS, easName } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { cachedSchemaLookup, getSchemaUidForModelFromCache, setSchemaUidForModel } from '@/stores/eas'
import { eq } from 'drizzle-orm'
import { models as modelsTable, modelUids } from '@/seedSchema'
import debug from 'debug'

const logger = debug('seedSdk:db:read:getSchemaUidForModel')

/**
 * EAS schema UID of a model's seeds: the in-memory cache, then `model_uids` (written from EAS by
 * startup and sync), then EAS itself. The DB comes before EAS so creating items and saving
 * images, files and Html bodies works offline. A failed EAS request (offline) counts as "no UID":
 * the seed is created without one and publish looks it up again.
 */
export const getEasSchemaUidForModel = async (
  modelName: string,
): Promise<string | null | undefined> => {
  const cached = getSchemaUidForModelFromCache(modelName)
  if (cached) return cached

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

  // The name publish registers the model's schema under (ADR 0008): `blog_post` for BlogPost.
  const modelType = easName(modelName)

  let easSchemaUid: string | undefined
  try {
    // Misses are cached too (most local models have no EAS schema).
    easSchemaUid = await cachedSchemaLookup(`model:${modelType}`, async () => {
      const queryClient = BaseQueryClient.getQueryClient()
      const easClient = BaseEasClient.getEasClient()

      const modelSchemaQuery = await queryClient.fetchQuery({
        queryKey: [`getEasSchemaUidForModel`, modelType],
        queryFn: async () =>
          easClient.request(GET_SCHEMAS, {
            where: {
              schemaNames: {
                some: {
                  name: {
                    equals: modelType,
                  },
                },
              },
            },
          }),
      })

      return modelSchemaQuery.schemas[0]?.id
    })
  } catch (error) {
    logger(`EAS schema lookup for model ${modelName} failed (offline?): ${error}`)
    return undefined
  }
  if (easSchemaUid) {
    setSchemaUidForModel({ modelName, schemaUid: easSchemaUid })
    return easSchemaUid
  }

  return undefined
}
