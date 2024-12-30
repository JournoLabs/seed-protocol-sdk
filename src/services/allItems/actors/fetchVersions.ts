import { EventObject, fromCallback } from 'xstate'
import { GET_VERSIONS } from '@/Item/queries'
import { AllItemsMachineContext, FromCallbackInput } from '@/types'
import { Attestation } from '@/graphql/gql/graphql'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'


export const fetchVersions = fromCallback<
  EventObject,
  FromCallbackInput<EventObject, AllItemsMachineContext>
>(
  ({ sendBack, input: { context } }) => {
    const { itemSeeds, modelName } = context

    if (!itemSeeds) {
      throw new Error('No queryVariables found')
    }

    let itemVersions: Attestation[] | undefined

    const _fetchVersions = async () => {
      const queryClient = BaseQueryClient.getQueryClient()
      const easClient = BaseEasClient.getEasClient()

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

    return () => { }
  },
)
