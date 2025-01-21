import { EventObject, fromCallback } from 'xstate'
import { fetchAllFilesMachine } from '@/schema/file/fetchAll/index'
import { ARWEAVE_HOST } from '@/services/internal/constants'
import { GET_FILES_METADATA } from '@/schema/file/queries'
import { getArweave } from '@/helpers/ArweaveClient'
import { fs } from '@zenfs/core'
import {
  getDataTypeFromString,
  getMimeType,
  identifyString,
} from '@/helpers'
import { appState } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { saveAppState } from '@/db/write/saveAppState'

const logger = debug('app:file:actors:fetchAll')

type FileType = {
  mimeType: string
  extension: string
}

// Map of common MIME types to file extensions
const fileTypeMap: Record<string, FileType> = {
  'image/jpeg': { mimeType: 'image/jpeg', extension: '.jpg' },
  'image/png': { mimeType: 'image/png', extension: '.png' },
  'application/json': { mimeType: 'application/json', extension: '.json' },
  'text/plain': { mimeType: 'text/plain', extension: '.txt' },
  // Add more MIME types and file extensions as needed
}

export const fetchAllMetadataRecords = fromCallback<
  EventObject,
  typeof fetchAllFilesMachine
>(({ sendBack, receive, input: { context, event } }) => {
  const { addresses } = context

  const _fetchAllMetadataRecords = async () => {
    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    const { filesMetadata } = await queryClient.fetchQuery({
      queryKey: ['getFilesMetadata', ...addresses],
      queryFn: async () =>
        easClient.request(GET_FILES_METADATA, {
          where: {
            attester: {
              in: addresses,
            },
            schema: {
              is: {
                id: {
                  equals:
                    '0x55fdefb36fcbbaebeb7d6b41dc3a1a9666e4e42154267c889de064faa7ede517',
                },
              },
            },
          },
        }),
    })

    return filesMetadata
  }

  _fetchAllMetadataRecords().then((filesMetadata) => {
    sendBack({ type: 'fetchingAllMetadataRecordsSuccess', filesMetadata })
  })

  return () => { }
})

export const fetchAllBinaryData = fromCallback<
  EventObject,
  typeof fetchAllFilesMachine
>(({ sendBack, input: { context } }) => {
  const { filesMetadata, addresses } = context

  const _fetchAllBinaryData = async () => {
    if (!(await fs.promises.exists('/files'))) {
      await fs.promises.mkdir('/files', { recursive: true })
    }

    if (!(await fs.promises.exists('/files/html'))) {
      await fs.promises.mkdir('/files/html', { recursive: true })
    }

    if (!(await fs.promises.exists('/files/json'))) {
      await fs.promises.mkdir('/files/json', { recursive: true })
    }

    if (!(await fs.promises.exists('/files/images'))) {
      await fs.promises.mkdir('/files/images', { recursive: true })
    }

    const appDb = BaseDb.getAppDb()

    if (!appDb) {
      logger('[fetchAll/actors] [fetchAllBinaryData] seedDb not available')
      return []
    }

    for (const fileMetadata of filesMetadata) {
      const json = JSON.parse(fileMetadata.decodedDataJson)
      const transactionId = json[0].value.value

      const excludedTransactionsQuery = await appDb
        .select()
        .from(appState)
        .where(eq(appState.key, 'excludedTransactions'))

      let excludedTransactions = new Set<string>()

      if (excludedTransactionsQuery && excludedTransactionsQuery.length === 1) {
        const valueString = excludedTransactionsQuery[0].value
        if (valueString) {
          const excludedTransactionsArray = JSON.parse(valueString)
          excludedTransactions = new Set(excludedTransactionsArray)
        }
      }

      if (excludedTransactions.has(transactionId)) {
        continue
      }

      const arweave = getArweave()

      if (!arweave) {
        logger('[fetchAll/actors] [fetchAllBinaryData] arweave not available')
        return []
      }

      try {
        const res = await fetch(
          `https://${ARWEAVE_HOST}/tx/${transactionId}/status`,
        )

        if (res.status !== 200) {
          logger(
            `[fetchAll/actors] [fetchAllBinaryData] error fetching transaction data for ${transactionId}`,
          )

          excludedTransactions.add(transactionId)

          await saveAppState(
            'excludedTransactions',
            JSON.stringify(Array.from(excludedTransactions)),
          )

          logger(
            '[fetchAll/actors] [fetchAllBinaryData] updated excludedTransactions:',
            excludedTransactions,
          )

          continue
        }

        const dataString = await arweave.transactions
          .getData(transactionId, {
            decode: true,
            string: true,
          })
          .catch((error) => {
            logger(
              `[fetchAll/actors] [fetchAllBinaryData] error fetching transaction data for ${transactionId}`,
              error,
            )
          })

        const dataUint8Array = await arweave.transactions.getData(transactionId)
        // let buffer
        //
        // if (dataUint8Array && dataUint8Array instanceof Uint8Array) {
        // }

        let contentType = identifyString(dataString)
        if (
          contentType !== 'json' &&
          contentType !== 'base64' &&
          contentType !== 'html'
        ) {
          const possibleImageType = getDataTypeFromString(dataString)
          if (!possibleImageType) {
            logger(
              `[fetchAll/actors] [fetchAllBinaryData] transaction ${transactionId} data not in expected format: ${possibleImageType}`,
            )
            continue
          }

          contentType = possibleImageType
        }

        if (contentType === 'url') {
          const url = dataString as string
          const response = await fetch(url)
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`)
          }

          // Get the image as a Blob
          const blob = await response.blob()
          const buffer = await blob.arrayBuffer()
          const bufferUint8Array = new Uint8Array(buffer)

          // Extract the file extension from the URL
          const extensionMatch = url.match(
            /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i,
          )
          if (!extensionMatch) {
            throw new Error(
              'Unable to determine the file extension from the URL.',
            )
          }
          const fileExtension = extensionMatch[0] // e.g., ".jpg"

          // Set the file name (you can customize this)
          // const fileNameFromUrl = `${transactionId}${fileExtension}`

          await fs.promises.writeFile(
            `/files/images/${transactionId}`,
            bufferUint8Array,
            {
              encoding: 'binary',
            },
          )

          continue
        }

        let mimeType = getMimeType(dataString as string)
        let fileExtension = mimeType

        if (fileExtension && fileExtension?.startsWith('image')) {
          fileExtension = fileExtension.replace('image/', '')
        }

        let fileName = transactionId

        if (contentType === 'base64') {
          if (mimeType) {
            fileName += `.${fileExtension}`
          }

          // Remove the Base64 header if it exists (e.g., "data:image/png;base64,")
          const base64Data = dataString.split(',').pop() || ''

          // Decode the Base64 string to binary
          const binaryString = atob(base64Data)
          const length = binaryString.length
          const binaryData = new Uint8Array(length)

          for (let i = 0; i < length; i++) {
            binaryData[i] = binaryString.charCodeAt(i)
          }

          console.log(`attempting to writeFile to /files/images/${fileName}`)

          await fs.promises.writeFile(`/files/images/${fileName}`, binaryData, {
            encoding: 'binary',
          })

          // if (dataUint8Array && dataUint8Array instanceof Uint8Array) {
          //   await fs.promises.writeFile(
          //     `/files/images/${fileName}`,
          //     dataUint8Array,
          //   )
          // }
        }

        if (contentType === 'html') {
          fileName += '.html'
          await fs.promises.writeFile(`/files/html/${fileName}`, dataString)
        }

        if (contentType === 'json') {
          fileName += '.json'
          await fs.promises.writeFile(`/files/json/${fileName}`, dataString)
        }
      } catch (error) {
        logger(error)
      }
    }

    return []
  }

  _fetchAllBinaryData().then((binaryData) => {
    sendBack({ type: 'fetchingAllBinaryDataSuccess', binaryData })
  })

  return () => { }
})
