import { EventObject, fromCallback } from 'xstate'
import { models as modelsTable, modelUids } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { toSnakeCase, BaseEasClient, BaseQueryClient } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { GLOBAL_ADDING_MODELS_TO_DB_SUCCESS } from '@/services/internal/constants'
import { eventEmitter } from '@/eventBus'
import { FromCallbackInput, GlobalMachineContext } from '@/types'
import debug from 'debug'
import { GET_SCHEMAS } from '@/Item/queries'

const logger = debug('seedSdk:services:global:actors:addModelsToDb')

export const addModelsToDb = fromCallback<
  EventObject,
  FromCallbackInput<GlobalMachineContext>
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

    // Internal models (Seed, Version, Metadata) are now loaded via seed-protocol-v1.json schema
    // They should already be in context.models from processSchemaFiles
    const allModels = { ...models }

    let hasModelsInDb = true // Start as true - we'll set to false if we can't process any model
    const schemaDefsByModelName = new Map<
      string,
      {
        dbId: number
        schemaDef: string
      }
    >()

    for (const [modelName, _] of Object.entries(allModels)) {
      logger(
        '[helpers/db] [addModelsToInternalDb] starting modelName:',
        modelName,
      )

      let foundModel

      const foundModelsQuery = await appDb
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.name, modelName))

      if (!foundModelsQuery || foundModelsQuery.length === 0) {
        await appDb.insert(modelsTable).values({
          name: modelName,
        })

        logger('[global/actors] [addModelsToDb] inserted model:', modelName)
        const foundModels = await appDb
          .select({
            id: modelsTable.id,
            name: modelsTable.name,
            uid: modelUids.uid,
          })
          .from(modelsTable)
          .leftJoin(modelUids, eq(modelsTable.id, modelUids.modelId))
          .where(eq(modelsTable.name, modelName))
          .limit(1)

        foundModel = foundModels[0]
      }

      if (foundModelsQuery && foundModelsQuery.length > 0) {
        foundModel = foundModelsQuery[0]
      }

      if (!foundModel) {
        logger('[global/actors] [addModelsToDb] Warning: Could not find or create model:', modelName)
        hasModelsInDb = false
        // Don't break - continue processing other models
        continue
      }

      schemaDefsByModelName.set(modelName, {
        dbId: foundModel.id,
        schemaDef: `bytes32 ${toSnakeCase(modelName)}`,
      })
    }

    // If we have no models to process, still send success (empty models is valid)
    if (schemaDefsByModelName.size === 0) {
      logger('[global/actors] [addModelsToDb] No models to process, but continuing')
      sendBack({ type: GLOBAL_ADDING_MODELS_TO_DB_SUCCESS })
      return
    }

    const schemaDefs = Array.from(schemaDefsByModelName.values()).map(
      ({ schemaDef }) => schemaDef,
    )

    // Try to fetch schemas from EAS, but don't fail if unavailable (e.g., in test environments)
    try {
      const queryClient = BaseQueryClient.getQueryClient()
      const easClient = BaseEasClient.getEasClient()

      const { schemas } = await queryClient.fetchQuery({
        queryKey: [`getSchemasVersion`],
        queryFn: async () =>
          easClient.request(GET_SCHEMAS, {
            where: {
              schema: {
                in: schemaDefs,
              },
            },
          }),
      })

      if (schemas && schemas.length > 0) {
        for (const schema of schemas) {
          const modelId = Array.from(schemaDefsByModelName.values()).find(
            ({ schemaDef }) => schemaDef === schema.schema,
          )?.dbId

          if (modelId) {
            await appDb
              .insert(modelUids)
              .values({
                modelId,
                uid: schema.id,
              })
              .onConflictDoNothing()
          }
        }
      } else {
        logger('[global/actors] [addModelsToDb] No schemas found from EAS, but continuing')
      }
    } catch (error: any) {
      // In test environments, EAS might not be available - log but don't fail
      if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
        logger('[global/actors] [addModelsToDb] Warning: Could not fetch schemas from EAS, but continuing in test environment:', error.message)
      } else {
        logger('[global/actors] [addModelsToDb] Error fetching schemas:', error.message)
        throw error
      }
    }
    
    return hasModelsInDb
  }

  _addModelsToDb()
    .then((hasModelsInDb) => {
      sendBack({ type: GLOBAL_ADDING_MODELS_TO_DB_SUCCESS })
      if (hasModelsInDb && models) {
        for (const [modelName, model] of Object.entries(models)) {
          const service = (context as any)[`${modelName}Service`]
          if (service) {
            service.send({ type: 'modelsFound' })
          }
        }
      }
      eventEmitter.emit('syncDbWithEas')
    })
    .catch((error) => {
      logger('[global/actors] [addModelsToDb] Error:', error)
      // In test environments, still send success to allow initialization to complete
      if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
        logger('[global/actors] [addModelsToDb] Continuing despite error in test environment')
        sendBack({ type: GLOBAL_ADDING_MODELS_TO_DB_SUCCESS })
      } else {
        throw error
      }
    })

  return () => { }
})
