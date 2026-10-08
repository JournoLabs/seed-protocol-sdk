import { EventObject, fromCallback } from 'xstate'
import { models as modelsTable, modelUids } from '@/seedSchema'
import { eq, inArray } from 'drizzle-orm'
import { toSnakeCase, BaseEasClient, BaseQueryClient } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { ClientManagerEvents } from '@/client/constants'
import { ClientManagerContext, FromCallbackInput } from '@/types/machines'
import debug from 'debug'
import { GET_SCHEMAS } from '@seedprotocol/eas'

const logger = debug('seedSdk:client:actors:addModelsToDb')

export const addModelsToDb = fromCallback<
  EventObject,
  FromCallbackInput<ClientManagerContext>
>(({ sendBack, input: { context } }) => {
  const { models } = context

  const _addModelsToDb = async () => {
    const appDb = BaseDb.getAppDb()

    if (!appDb) {
      throw new Error('Database not ready')
    }

    if (!models) {
      return
    }

    // Internal models (Seed, Version, Metadata) are now loaded via SEEDPROTOCOL_Seed_Protocol_v1.json schema
    // They should already be in context.models from processSchemaFiles
    const allModels = { ...models }
    const modelNames = Object.keys(allModels)

    if (modelNames.length === 0) {
      return
    }

    const schemaDefsByModelName = new Map<
      string,
      {
        dbIds: number[]
        schemaDef: string
      }
    >()

    // Batch fetch all existing same-name models in one query (avoids N sequential queries).
    // Model names are only unique per schema, so match each Model by its id (schemaFileId) first.
    type ModelRow = { id: number; name: string; schemaFileId: string | null }
    const existingModels = (await appDb
      .select({ id: modelsTable.id, name: modelsTable.name, schemaFileId: modelsTable.schemaFileId })
      .from(modelsTable)
      .where(inArray(modelsTable.name, modelNames))) as ModelRow[]

    const rowFor = (modelName: string): ModelRow | undefined => {
      const modelFileId = (allModels[modelName] as { id?: string } | undefined)?.id
      const sameName = existingModels.filter((m) => m.name === modelName)
      return (
        (modelFileId ? sameName.find((m) => m.schemaFileId === modelFileId) : undefined) ??
        (sameName.length === 1 ? sameName[0] : undefined) ??
        sameName.find((m) => !m.schemaFileId)
      )
    }
    const modelsToInsert = modelNames.filter((name) => !existingModels.some((m) => m.name === name))

    // Batch insert missing models
    if (modelsToInsert.length > 0) {
      const newlyInserted = (await appDb
        .insert(modelsTable)
        // Null schemaFileId stubs; the schema import adopts them (findOrCreateModelRecord).
        .values(modelsToInsert.map((name) => ({ name })))
        .returning({ id: modelsTable.id, name: modelsTable.name, schemaFileId: modelsTable.schemaFileId })) as ModelRow[]

      existingModels.push(...newlyInserted)
      for (const name of modelsToInsert) {
        logger('[client/actors] [addModelsToDb] inserted model:', name)
      }
    }

    let hasModelsInDb = true
    for (const modelName of modelNames) {
      const foundModel = rowFor(modelName)
      if (!foundModel) {
        logger('[client/actors] [addModelsToDb] Warning: Could not find or create model:', modelName)
        hasModelsInDb = false
        continue
      }
      // The EAS schema string depends only on the model name, so every same-name row shares its uid.
      schemaDefsByModelName.set(modelName, {
        dbIds: existingModels.filter((m) => m.name === modelName).map((m) => m.id),
        schemaDef: `bytes32 ${toSnakeCase(modelName)}`,
      })
    }

    // If we have no models to process, still send success (empty models is valid)
    if (schemaDefsByModelName.size === 0) {
      logger('[client/actors] [addModelsToDb] No models to process, but continuing')
      sendBack({ type: ClientManagerEvents.ADD_MODELS_TO_DB_SUCCESS })
      return
    }

    const schemaDefs = Array.from(schemaDefsByModelName.values()).map(
      ({ schemaDef }) => schemaDef,
    )

    // Fetch schemas from EAS in background - do not block init. EAS can be slow (10s+);
    // modelUids will be populated async and EAS sync orchestrator runs when done.
    const fetchEasAndPopulateModelUids = async () => {
      try {
        const queryClient = BaseQueryClient.getQueryClient()
        const easClient = BaseEasClient.getEasClient()

        const queryPromise = queryClient.fetchQuery({
          queryKey: [`getSchemasVersion`, [...schemaDefs].sort()],
          queryFn: async () =>
            easClient.request(GET_SCHEMAS, {
              where: {
                schema: {
                  in: schemaDefs,
                },
              },
            }),
        })

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('EAS query timeout after 10 seconds')), 10000)
        )

        const { schemas } = await Promise.race([queryPromise, timeoutPromise])

        if (schemas && schemas.length > 0) {
          const db = BaseDb.getAppDb()
          if (db) {
            for (const schema of schemas) {
              const modelIds =
                Array.from(schemaDefsByModelName.values()).find(
                  ({ schemaDef }) => schemaDef === schema.schema,
                )?.dbIds ?? []

              for (const modelId of modelIds) {
                await db
                  .insert(modelUids)
                  .values({
                    modelId,
                    uid: schema.id,
                  })
                  .onConflictDoNothing()
              }
            }
          }
          const { requestEasSyncFromModelsInit } = await import(
            '@/events/item/easSyncManager'
          )
          requestEasSyncFromModelsInit()
        } else {
          logger('[client/actors] [addModelsToDb] No schemas found from EAS, but continuing')
        }
      } catch (error: any) {
        if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
          logger('[client/actors] [addModelsToDb] Warning: Could not fetch schemas from EAS (background):', error.message)
        } else {
          logger('[client/actors] [addModelsToDb] Error fetching schemas (background):', error.message)
        }
      }
    }

    fetchEasAndPopulateModelUids()

    return hasModelsInDb
  }

  _addModelsToDb()
    .then(() => {
      sendBack({ type: ClientManagerEvents.ADD_MODELS_TO_DB_SUCCESS })
    })
    .catch((error) => {
      logger('[client/actors] [addModelsToDb] Error:', error)
      // In test environments, still send success to allow initialization to complete
      if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
        logger('[client/actors] [addModelsToDb] Continuing despite error in test environment')
        sendBack({ type: ClientManagerEvents.ADD_MODELS_TO_DB_SUCCESS })
      } else {
        sendBack({
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    })

  return () => { }
})

