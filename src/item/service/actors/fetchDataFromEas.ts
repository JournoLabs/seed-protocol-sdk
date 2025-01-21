import { EventObject, fromCallback } from 'xstate'
import { GET_PROPERTIES } from '@/Item/queries'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import { PropertyType } from '@/seedSchema'
import { Attestation } from '@/graphql/gql/graphql'
import { ModelClassType } from '@/types'
import { BaseEasClient, BaseQueryClient } from '@/helpers'


export const fetchDataFromEas = fromCallback<
  EventObject,
  typeof itemMachineSingle
>(({ sendBack, input: { context } }) => {
  const { ModelClass, modelTableName, versionUid } = context

  const propertiesMetadata = new Map<string, PropertyType>()

  // EAS is the final source of truth, so we need to see if our Item is
  // already represented there. Then we need to intelligently sync/merge
  // with whatever new data has been created on the device before the sync.
  for (const [propertyName, propertyMetadata] of Object.entries(
    (ModelClass as ModelClassType).schema,
  )) {
    if (propertyMetadata) {
      propertiesMetadata.set(propertyName, propertyMetadata)
    }
  }

  sendBack({ type: 'updatePropertiesMetadata', propertiesMetadata })

  if (!versionUid) {
    // In this case this is a local only item, so we don't need to fetch anything
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

    // Filter properties by schemaId
    const selectedPropertiesMap: {
      [schemaId: string]: Attestation[]
    } = {}
    itemProperties.forEach((property) => {
      const existingProperties = selectedPropertiesMap[property.schemaId] || []
      existingProperties.push(property)
      selectedPropertiesMap[property.schemaId] = existingProperties
    })

    // For each schemaId, sort property Attestations by timeCreated DESC
    Object.keys(selectedPropertiesMap).forEach((schemaId) => {
      const sorted = selectedPropertiesMap[schemaId].sort((a, b) => {
        return a.timeCreated - b.timeCreated
      })
      selectedPropertiesMap[schemaId] = sorted
    })

    Object.keys(selectedPropertiesMap).forEach((schemaId) => {
      // TODO: Finish this logic
      // console.log('[singleItemActors] [fetchDataFromEas] schemaId', schemaId)
      // sendBack({ type: 'addPropertyAttestation', schemaId })
    })

    // Attach processed properties to the itemService/itemMachine context
    sendBack({
      type: 'updatedPropertiesBySchemaUid',
      propertiesBySchemaUid: selectedPropertiesMap,
    })
  }

  _fetchDataFromEas().then(() => {
    sendBack({ type: 'fetchDataFromEasSuccess' })
  })
})
