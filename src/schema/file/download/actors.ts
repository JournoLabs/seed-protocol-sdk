import { EventObject, fromCallback } from 'xstate'
import { downloadMachine } from '@/schema/file/download'
import { GET_FILES_METADATA } from '@/schema/file/queries'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'


export const fetchMetadata = fromCallback<EventObject, typeof downloadMachine>(
  ({ sendBack, input: { context } }) => {
    const { addresses } = context

    const fetchMetadata = async () => {
      const queryClient = BaseQueryClient.getQueryClient()
      const easClient = BaseEasClient.getEasClient()

      const metadataRecords = await queryClient.fetchQuery({
        queryKey: ['getFilesMetadata', ...addresses],
        queryFn: async () =>
          easClient.request(GET_FILES_METADATA, {
            where: {
              attester: {
                in: addresses,
              },
              decodedDataJson: {
                contains: 'transactionId',
              },
            },
          }),
      })

      return metadataRecords
    }

    fetchMetadata().then((metadataRecords) => {
      sendBack({ type: 'fetchingMetadataSuccess', metadataRecords })
    })

    return () => { }
  },
)

export const fetchBinaryData = fromCallback<
  EventObject,
  typeof downloadMachine
>(({ sendBack, receive, input: { context } }) => {
  const { addresses } = context

  const fetchBinaryData = async () => {
    return []
  }

  fetchBinaryData().then(() => {
    sendBack({ type: 'fetchingBinaryDataSuccess' })
  })

  return () => { }
})
