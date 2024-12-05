import { EventObject, fromCallback } from 'xstate'
import { downloadMachine } from '@/browser/schema/file/download/index'
import { GET_FILES_METADATA } from '@/browser/schema/file/queries'
import { easClient, queryClient } from '@/browser/helpers'

export const fetchMetadata = fromCallback<EventObject, typeof downloadMachine>(
  ({ sendBack, input: { context } }) => {
    const { addresses } = context

    const fetchMetadata = async () => {
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

    return () => {}
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

  return () => {}
})
