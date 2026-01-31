import { EventObject, fromCallback } from 'xstate'
import { GET_FILES_METADATA } from '@/helpers/file/queries'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'

type DownloadMachineContext = {
  addresses: string[]
  fileName?: string
  metadata?: any
  binaryData?: any
  metadataServiceUrl?: string
  blobServiceUrl?: string
}

export const fetchMetadata = fromCallback<EventObject, { context: DownloadMachineContext }>(
  ({ sendBack, input: { context } }): (() => void) => {
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
  { context: DownloadMachineContext }
>(({ sendBack, receive, input: { context } }): (() => void) => {
  const { addresses } = context

  const fetchBinaryData = async () => {
    return []
  }

  fetchBinaryData().then(() => {
    sendBack({ type: 'fetchingBinaryDataSuccess' })
  })

  return () => { }
})
