import { EventObject, fromCallback } from 'xstate'
import { GET_SCHEMAS } from '@/Item/queries'
import pluralize from 'pluralize'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { toSnakeCase } from '@/helpers'
import {
  models as modelsTable,
  modelUids,
  properties,
  propertyUids,
} from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { SchemaWhereInput } from '@/graphql/gql/graphql'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { getAddressesFromDb } from '@/helpers/db'
import { eventEmitter } from '@/eventBus'
import { BaseDb } from '@/db/Db/BaseDb'

import { AllItemsMachineContext, FromCallbackInput } from '@/types'


type Times = {
  initialize?: {
    start: number | null
    end: number | null
  }
  fetchDbData?: {
    start: number | null
    end: number | null
  }
  fetchSeeds?: {
    start: number | null
    end: number | null
  }
  fetchVersions?: {
    start: number | null
    end: number | null
  }
  fetchRelatedItems?: {
    start: number | null
    end: number | null
  }
  processItems?: {
    start: number | null
    end: number | null
  }
}

type InternalDataType = keyof typeof INTERNAL_DATA_TYPES;

export const initialize = fromCallback<
  EventObject,
  FromCallbackInput<AllItemsMachineContext>
>(({ sendBack, input: { context } }) => {
  const { modelName, modelAddedToDb, ModelClass, times } = context

  const newTimes: Times = {
    initialize: {
      start: Date.now(),
      end: null,
    },
  }

  let modelNameLowercase: string | undefined
  let modelNamePlural: string | undefined
  let queryVariables: Record<string, unknown> | undefined
  let appDb

  const _initialize = async () => {
    appDb = BaseDb.getAppDb()

    // const rows = await getItemsDataFromDb(modelName)
    //
    // if (rows && rows.length > 0) {
    //   for (const itemData of rows) {
    //     const {
    //       versionLocalId,
    //       versionUid,
    //       createdAt,
    //       seedLocalId,
    //       seedUid,
    //       attestationCreatedAt,
    //     } = itemData
    //
    //     eventEmitter.emit('item.create.request', {
    //       itemData: {
    //         versionLocalId,
    //         versionUid,
    //         createdAt,
    //         seedLocalId,
    //         seedUid,
    //         attestationCreatedAt,
    //       },
    //       ModelClass,
    //     })
    //   }
    // }

    modelNameLowercase = modelName.toLowerCase()
    modelNamePlural = pluralize(modelNameLowercase!)

    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    const modelSchemas = await queryClient.fetchQuery({
      queryKey: [`getSchemas${modelName}`],
      queryFn: async () =>
        easClient.request(GET_SCHEMAS, {
          where: {
            schema: {
              equals: `bytes32 ${toSnakeCase(modelName)}`,
            },
          },
        }),
    })

    if (
      !modelSchemas ||
      !modelSchemas.schemas ||
      modelSchemas.schemas.length === 0
    ) {
      throw new Error(`No schema found for ${modelName}`)
    }

    const modelSchema = modelSchemas.schemas[0]

    if (!modelSchema.id) {
      throw new Error(
        `No schema ID found for schema ${JSON.stringify(modelSchema)}`,
      )
    }

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

    const foundModel = foundModels[0]

    if (!foundModel) {
      sendBack({ type: 'modelNotFound', modelName })
      return
    }

    await appDb
      .insert(modelUids)
      .values({
        modelId: foundModel.id,
        uid: modelSchema.id,
      })
      .onConflictDoNothing()

    const foundPropertiesDb = await appDb
      .select({
        id: properties.id,
        name: properties.name,
        dataType: properties.dataType,
        uid: propertyUids.uid,
      })
      .from(properties)
      .fullJoin(propertyUids, eq(properties.id, propertyUids.propertyId))
      .where(eq(properties.modelId, foundModel.id))

    if (foundPropertiesDb && foundPropertiesDb.length > 0) {
      const queryVariables: { where: SchemaWhereInput } = {
        where: {
          OR: [],
        },
      }

      for (const foundPropertyDb of foundPropertiesDb) {
        if (foundPropertyDb.name && foundPropertyDb.dataType) {
          const easDatatype = INTERNAL_DATA_TYPES[foundPropertyDb.dataType as InternalDataType].eas

          let easPropertyName = toSnakeCase(foundPropertyDb.name)

          if (foundPropertyDb.dataType === 'Relation') {
            easPropertyName += '_id'
          }

          queryVariables.where.OR!.push({
            schema: {
              equals: `${easDatatype} ${easPropertyName}`,
            },
          })
        }
      }

      const foundPropertySchemas = await queryClient.fetchQuery({
        queryKey: [`getPropertySchemas${modelName}`],
        queryFn: async () => easClient.request(GET_SCHEMAS, queryVariables),
      })

      const tempExclusions = ['html', 'json']

      for (const foundProperty of foundPropertiesDb) {
        if (tempExclusions.includes(foundProperty.name)) {
          continue
        }
        const easDatatype = INTERNAL_DATA_TYPES[foundProperty.dataType as InternalDataType].eas

        let easPropertyName = toSnakeCase(foundProperty.name)

        if (foundProperty.dataType === 'Relation') {
          easPropertyName += '_id'
        }

        const regex = new RegExp(`${easDatatype} ${easPropertyName}`)
        const propertySchema = foundPropertySchemas.schemas.find((s) =>
          regex.test(s.schema),
        )

        if (!propertySchema) {
          // TODO: We should create the schema here?
          continue
        }
        await appDb
          .insert(propertyUids)
          .values({
            propertyId: foundProperty.id,
            uid: propertySchema.id,
          })
          .onConflictDoNothing()
      }
    }

    const addresses = await getAddressesFromDb()

    queryVariables = {
      where: {
        attester: {
          in: addresses,
        },
        schemaId: {
          equals: modelSchema.id,
        },
        decodedDataJson: {
          contains: modelSchema.id,
        },
      },
    }
  }

  const initializeHandler = () => {
    _initialize().then(() => {
      sendBack({
        type: 'initializeSuccess',
        modelName,
        modelNameLowercase,
        modelNamePlural,
        queryVariables,
      })
      newTimes!.initialize!.end = Date.now()
      sendBack({ type: 'updateTimes', times: newTimes })
    })
  }

  if (modelAddedToDb) {
    initializeHandler()
  }

  const dbReadyHandler = (event) => {
    initializeHandler()
  }

  eventEmitter.addListener('allDbsLoaded', dbReadyHandler)

  return () => {
    eventEmitter.removeListener('allDbsLoaded', dbReadyHandler)
  }
})
