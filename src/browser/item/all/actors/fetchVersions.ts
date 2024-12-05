import { EventObject, fromCallback } from 'xstate'
import { GET_VERSIONS } from '@/browser/item/queries'
import { itemMachineAll } from '@/browser/item/all/itemMachineAll'
import { Attestation } from '@/browser/gql/graphql'
import { easClient, queryClient } from '@/browser/helpers'

export const fetchVersions = fromCallback<EventObject, typeof itemMachineAll>(
  ({ sendBack, input: { context } }) => {
    const { itemSeeds, modelName } = context

    if (!itemSeeds) {
      throw new Error('No queryVariables found')
    }

    let itemVersions: Attestation[] | undefined

    const _fetchVersions = async () => {
      const seedIds = itemSeeds.map((seed) => seed.id)

      const results = await queryClient.fetchQuery({
        queryKey: [`getVersions${modelName}`],
        queryFn: async () =>
          easClient.request(GET_VERSIONS, {
            where: {
              refUID: {
                in: seedIds,
              },
            },
          }),
      })

      itemVersions = results.itemVersions
    }

    _fetchVersions().then(() => {
      sendBack({ type: 'fetchVersionsSuccess', itemVersions })
    })

    return () => {}
  },
)
