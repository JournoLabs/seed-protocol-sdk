import { EventObject, fromCallback } from 'xstate'
import { GET_SEEDS } from '@/browser/item/queries'
import { itemMachineAll } from '@/browser/item/all/itemMachineAll'
import { Attestation } from '@/browser/gql/graphql'
import { easClient, queryClient } from '@/browser/helpers'
import debug from 'debug'

const logger = debug('app:allItemsActors:fetchSeeds')

export const fetchSeeds = fromCallback<EventObject, typeof itemMachineAll>(
  ({ sendBack, input: { context } }) => {
    const { queryVariables, modelName } = context

    if (!queryVariables) {
      throw new Error('No queryVariables found')
    }

    let itemSeeds: Attestation[] | undefined

    const _fetchSeeds = async () => {
      const queryKey = [`getSeeds${modelName}`]

      const cachedResults = queryClient.getQueryData(queryKey)

      logger(
        `[allItemsActors] [fetchSeeds] cachedResults ${Date.now()}`,
        cachedResults,
      )

      const results = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => easClient.request(GET_SEEDS, queryVariables),
      })

      itemSeeds = results.itemSeeds
    }

    _fetchSeeds().then(() => {
      sendBack({ type: 'fetchSeedsSuccess', itemSeeds })
    })

    return () => {}
  },
)
