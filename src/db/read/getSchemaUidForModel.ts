import { GET_SCHEMAS } from '@/Item/queries'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { eq } from 'drizzle-orm'
import { models as modelsTable, modelUids } from '@/seedSchema'

export const getSchemaUidForModel = async (
  modelName: string,
): Promise<string | null | undefined> => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const modeType = modelName.toLowerCase()

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

  const foundSchema = modelSchemaQuery.schemas[0]
  if (foundSchema) return foundSchema.id

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
    if (uid) return uid
  }

  return undefined
}
