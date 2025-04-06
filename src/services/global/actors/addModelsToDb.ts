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

    if (!models) {
      return
    }

    const { models: SeedModels } = await import(
      '@/db/configs/seed.schema.config'
    )

    const allModels = {
      ...SeedModels,
      ...models,
    }

    let hasModelsInDb = false
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
        hasModelsInDb = false
        break
      }

      schemaDefsByModelName.set(modelName, {
        dbId: foundModel.id,
        schemaDef: `bytes32 ${toSnakeCase(modelName)}`,
      })
    }

    if (!hasModelsInDb) {
      return false
    }

    const schemaDefs = Array.from(schemaDefsByModelName.values()).map(
      ({ schemaDef }) => schemaDef,
    )

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

    if (!schemas || schemas.length === 0) {
      throw new Error(`No schemas found`)
    }

    for (const schema of schemas) {
      const modelId = Array.from(schemaDefsByModelName.values()).find(
        ({ schemaDef }) => schemaDef === schema.schema,
      )?.dbId

      if (!modelId) {
        throw new Error(`No modelId found for schema ${schema.schema}`)
      }

      await appDb
        .insert(modelUids)
        .values({
          modelId,
          uid: schema.id,
        })
        .onConflictDoNothing()
    }
  }

  _addModelsToDb().then((hasModelsInDb) => {
    sendBack({ type: GLOBAL_ADDING_MODELS_TO_DB_SUCCESS })
    if (hasModelsInDb) {
    }
    for (const [modelName, model] of Object.entries(models)) {
      const service = context[`${modelName}Service`]
      service.send({ type: 'modelsFound' })
    }
    eventEmitter.emit('syncDbWithEas')
    return
  })

  return () => { }
})
