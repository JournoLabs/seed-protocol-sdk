import { EventObject, fromCallback } from 'xstate'
import { GET_PROPERTIES } from '@/Item/queries'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import { PropertyType } from '@/seedSchema'
import { Attestation } from '@/graphql/gql/graphql'
import { BaseEasClient, BaseQueryClient } from '@/helpers'
// Dynamic import to break circular dependency: Model -> BaseItem -> ... -> fetchDataFromEas -> Model
// import { Model } from '@/Model/Model'
import { modelPropertiesToObject } from '@/helpers/model'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@/helpers/easPropertyCanonical'

import { FromCallbackInput, ItemMachineContext } from '@/types'

export const fetchDataFromEas = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(({ sendBack, input: { context } }) => {
  const { ModelClass, modelTableName, versionUid, modelName } = context

  const _initializeAndFetch = async (): Promise<void> => {
    const propertiesMetadata = new Map<string, PropertyType>()

    // Get model schema - prefer ModelClass if available, otherwise look up by modelName
    let modelSchema: Record<string, PropertyType> | undefined
    if (ModelClass && ModelClass.properties) {
      modelSchema = modelPropertiesToObject(ModelClass.properties)
    } else if (modelName) {
      // Dynamic import to break circular dependency
      const modelMod = await import('../../../Model/Model')
      const { Model } = modelMod
      const model = Model.getByName(modelName)
      modelSchema = model?.properties ? modelPropertiesToObject(model.properties) : undefined
    }

    // EAS is the final source of truth, so we need to see if our Item is
    // already represented there. Then we need to intelligently sync/merge
    // with whatever new data has been created on the device before the sync.
    if (modelSchema) {
      for (const [propertyName, propertyMetadata] of Object.entries(modelSchema)) {
        if (propertyMetadata) {
          propertiesMetadata.set(propertyName, propertyMetadata)
        }
      }
    }

    sendBack({ type: 'updatePropertiesMetadata', propertiesMetadata })

    if (!versionUid) {
      // In this case this is a local only item, so we don't need to fetch anything
      sendBack({ type: 'fetchDataFromEasSuccess' })
      return
    }

    const _fetchDataFromEas = async (): Promise<void> => {
      const queryClient = BaseQueryClient.getQueryClient()
      const easClient = BaseEasClient.getEasClient()

      // Fetch Properties by versionUid
      const { itemProperties } = await queryClient.fetchQuery({
        queryKey: ['getProperties', versionUid],
        queryFn: async () =>
          easClient.request(GET_PROPERTIES, {
            where: {
              refUID: {
                in: [versionUid],
              },
              decodedDataJson: {
                not: {
                  // The first of many filters to keep bad data out
                  contains:
                    '"value":"0x0000000000000000000000000000000000000000000000000000000000000020"',
                },
              },
            },
          }),
      })

      const latest = pickLatestPropertyAttestationsByRefAndSchema(itemProperties as Attestation[])
      const selectedPropertiesMap: { [schemaId: string]: Attestation[] } = {}
      for (const property of latest) {
        const sid = property.schemaId
        if (!sid) continue
        selectedPropertiesMap[sid] = [property]
      }

      sendBack({
        type: 'updatedPropertiesBySchemaUid',
        propertiesBySchemaUid: selectedPropertiesMap,
      })
      
      sendBack({ type: 'fetchDataFromEasSuccess' })
    }

    await _fetchDataFromEas()
  }

  _initializeAndFetch().catch((error) => {
    console.error('[fetchDataFromEas] Error:', error)
    sendBack({ type: 'fetchDataFromEasError', error })
  })
})
