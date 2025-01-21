import { EventObject, fromCallback } from 'xstate'
import {
  GET_ALL_PROPERTIES_FOR_ALL_VERSIONS,
  GET_SEED_IDS,
  GET_VERSIONS,
} from '@/Item/queries'
import {
  models as modelsTable,
  modelUids,
  PropertyType,
} from '@/seedSchema'
import { Attestation } from '@/graphql/gql/graphql'
import {
  AllItemsMachineContext,
  FromCallbackInput,
  ModelClassType,
} from '@/types'
import { getAddressesFromDb } from '@/helpers/db'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'


export const fetchRelatedItems = fromCallback<
  EventObject,
  FromCallbackInput<AllItemsMachineContext>
>(({ sendBack, input: { context } }) => {
  const { ModelClass, modelName } = context

  const appDb = BaseDb.getAppDb()

  const relatedProperties = new Map<string, PropertyType>()
  const relatedVersionsBySeedUid = new Map<string, Attestation[]>()
  const schemaUidsByModelName = new Map<string, string>()
  const mostRecentVersionsBySeedUid = new Map<string, Attestation>()
  const mostRecentPropertiesBySeedUid = new Map<string, Attestation[]>()
  const seedUidsByMostRecentVersionUid = new Map<string, string>()

  const _fetchRelatedItems = async () => {
    // Get related properties
    for (const [propertyName, propertyDef] of Object.entries(
      (ModelClass as ModelClassType).schema,
    )) {
      if (propertyDef && propertyDef.ref && propertyDef.refModelId) {
        relatedProperties.set(propertyName, propertyDef)
      }
    }

    const addresses = await getAddressesFromDb(appDb)

    // Get the models they point to from sdkConfigDb
    for (const [propertyName, propertyDef] of relatedProperties.entries()) {
      const relatedModelQuery = await appDb
        .select({
          id: modelsTable.id,
          name: modelsTable.name,
          uid: modelUids.uid,
        })
        .from(modelsTable)
        .leftJoin(modelUids, eq(modelsTable.id, modelUids.modelId))
        .where(eq(modelsTable.id, propertyDef.refModelId))
        .limit(1)

      if (relatedModelQuery && relatedModelQuery.length > 0) {
        const relatedModel = relatedModelQuery[0]
        const relatedModelUid = relatedModel.uid
        // Exclude the current model's schemaUid since we already have its versions
        if (relatedModelUid && relatedModelUid !== ModelClass.schemaUid) {
          schemaUidsByModelName.set(relatedModel.name, relatedModelUid)
        }
      }
    }

    const queryKey = [`getRelatedSeedIds${modelName}`]

    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    const { itemSeedIds: relatedSeedIdAttestations } =
      await queryClient.fetchQuery({
        queryKey,
        queryFn: async () =>
          easClient.request(GET_SEED_IDS, {
            where: {
              schema: {
                is: {
                  id: {
                    in: Array.from(schemaUidsByModelName.values()),
                  },
                },
              },
              attester: {
                in: addresses,
              },
            },
          }),
      })

    const relatedSeedIds = relatedSeedIdAttestations.map((seed) => seed.id)

    const { itemVersions: relatedVersions } = await queryClient.fetchQuery({
      queryKey: [`getRelatedVersions${modelName}`],
      queryFn: async () =>
        easClient.request(GET_VERSIONS, {
          where: {
            refUID: {
              in: relatedSeedIds,
            },
            attester: {
              in: addresses,
            },
          },
        }),
    })

    // Index versions by seedUid
    for (const version of relatedVersions) {
      const existingVersionsForSeedUid =
        relatedVersionsBySeedUid.get(version.refUID) || []
      existingVersionsForSeedUid.push(version)
      relatedVersionsBySeedUid.set(version.refUID, existingVersionsForSeedUid)
    }

    // Sort the indexed versions by timeCreated and index the most recent
    for (const [
      seedUid,
      versionsForSeed,
    ] of relatedVersionsBySeedUid.entries()) {
      const versionsForSeedSorted = versionsForSeed.sort(
        (a: Attestation, b: Attestation) => {
          return a.timeCreated - b.timeCreated
        },
      )
      relatedVersionsBySeedUid.set(seedUid, versionsForSeedSorted)
      mostRecentVersionsBySeedUid.set(seedUid, versionsForSeedSorted[0])
      seedUidsByMostRecentVersionUid.set(versionsForSeedSorted[0].id, seedUid)
    }

    // Extract the ids of the most recent versions
    const mostRecentVersionIds = Array.from(
      mostRecentVersionsBySeedUid.values(),
    ).map((version) => version.id)

    const { allProperties } = await queryClient.fetchQuery({
      queryKey: [`getAllProperties${modelName}`],
      queryFn: async () =>
        easClient.request(GET_ALL_PROPERTIES_FOR_ALL_VERSIONS, {
          where: {
            refUID: {
              in: mostRecentVersionIds,
            },
            attester: {
              in: addresses,
            },
          },
        }),
    })

    for (const propertyAttestation of allProperties) {
      const seedUidForProperty = seedUidsByMostRecentVersionUid.get(
        propertyAttestation.refUID,
      )
      const existingPropertiesForSeedUid =
        mostRecentPropertiesBySeedUid.get(seedUidForProperty!) || []
      existingPropertiesForSeedUid.push(propertyAttestation)
      mostRecentPropertiesBySeedUid.set(
        seedUidForProperty!,
        existingPropertiesForSeedUid,
      )
    }
  }

  _fetchRelatedItems().then(() => {
    sendBack({
      type: 'fetchRelatedItemsSuccess',
      mostRecentPropertiesBySeedUid,
      relatedVersionsBySeedUid,
      relatedProperties,
      schemaUidsByModelName,
    })
    return
  })
})
