import { EventObject, fromCallback } from 'xstate'
import { GET_SEEDS } from '@/Item/queries'
import { AllItemsMachineContext, FromCallbackInput } from '@/types'
import { Attestation } from '@/graphql/gql/graphql'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import debug from 'debug'


const logger = debug('app:allItemsActors:fetchSeeds')

export const fetchSeeds = fromCallback<
  EventObject,
  FromCallbackInput<AllItemsMachineContext>
>(
  ({ sendBack, input: { context } }) => {
    const { queryVariables, modelName } = context

    if (!queryVariables) {
      throw new Error('No queryVariables found')
    }

    let itemSeeds: Attestation[] | undefined

    const _fetchSeeds = async () => {
      const queryKey = [`getSeeds${modelName}`]

      const queryClient = BaseQueryClient.getQueryClient()
      const easClient = BaseEasClient.getEasClient()

      const results = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => easClient.request(GET_SEEDS, queryVariables),
      })

      itemSeeds = results.itemSeeds
    }

    _fetchSeeds().then(() => {
      sendBack({ type: 'fetchSeedsSuccess', itemSeeds })
    })

    return () => { }
  },
)
