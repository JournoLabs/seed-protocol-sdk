import { EventObject, fromCallback } from 'xstate'
import { fetchAllFilesMachine } from '@/helpers/file/fetchAll/index'
import { GET_FILES_METADATA } from '@/helpers/file/queries'
import {
  BaseFileManager,
  getDataTypeFromString,
  getMimeType,
  identifyString,
} from '@/helpers'
import { appState } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { saveAppState } from '@/db/write/saveAppState'

const logger = debug('seedSdk:file:actors:fetchAll')

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

type FetchAllFilesMachineContext = {
  addresses: string[]
  dbsLoaded: boolean
  filesMetadata?: any[]
  filesBlobData?: any[]
}

export const fetchAllMetadataRecords = fromCallback<
  EventObject,
  { context: FetchAllFilesMachineContext; event?: any }
>(({ sendBack, receive, input: { context, event } }): (() => void) => {
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
  { context: FetchAllFilesMachineContext }
>(({ sendBack, input: { context } }): (() => void) => {
  const { filesMetadata, addresses } = context

  if (!filesMetadata || filesMetadata.length === 0) {
    sendBack({ type: 'fetchingAllBinaryDataSuccess', binaryData: [] })
    return () => { }
  }

  const _fetchAllBinaryData = async () => {
    const fs = await BaseFileManager.getFs()

    const filesRoot = BaseFileManager.getWorkingDir()
    if (!(await fs.promises.exists(filesRoot))) {
      await fs.promises.mkdir(filesRoot, { recursive: true })
    }

    const htmlDir = BaseFileManager.getFilesPath('html')
    if (!(await fs.promises.exists(htmlDir))) {
      await fs.promises.mkdir(htmlDir, { recursive: true })
    }

    const jsonDir = BaseFileManager.getFilesPath('json')
    if (!(await fs.promises.exists(jsonDir))) {
      await fs.promises.mkdir(jsonDir, { recursive: true })
    }

    const imagesDir = BaseFileManager.getFilesPath('images')
    if (!(await fs.promises.exists(imagesDir))) {
      await fs.promises.mkdir(imagesDir, { recursive: true })
    }

    const appDb = BaseDb.getAppDb()

    if (!appDb) {
      logger('[fetchAll/actors] [fetchAllBinaryData] seedDb not available')
      return []
    }

    for (const fileMetadata of filesMetadata) {
      // Validate and parse decodedDataJson
      if (!fileMetadata.decodedDataJson || fileMetadata.decodedDataJson.trim() === '') {
        logger('[fetchAll/actors] [fetchAllBinaryData] empty decodedDataJson for fileMetadata: ' + fileMetadata.id)
        continue
      }

      let json
      try {
        json = JSON.parse(fileMetadata.decodedDataJson)
      } catch (error) {
        logger('[fetchAll/actors] [fetchAllBinaryData] failed to parse decodedDataJson for fileMetadata: ' + fileMetadata.id + ', error: ' + error)
        continue
      }

      if (!Array.isArray(json) || json.length === 0 || !json[0]?.value?.value) {
        logger('[fetchAll/actors] [fetchAllBinaryData] invalid decodedDataJson structure for fileMetadata: ' + fileMetadata.id)
        continue
      }

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

      try {
        // Use BaseArweaveClient for transaction status check
        const status = await BaseArweaveClient.getTransactionStatus(transactionId)

        if (status.status !== 200) {
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

        // Use BaseArweaveClient for fetching transaction data
        let dataString: string | undefined
        try {
          const data = await BaseArweaveClient.getTransactionData(transactionId, {
            decode: true,
            string: true,
          })
          dataString = typeof data === 'string' ? data : new TextDecoder().decode(data)
        } catch (error) {
          logger(
            `[fetchAll/actors] [fetchAllBinaryData] error fetching transaction data for ${transactionId}`,
            error,
          )
          continue
        }

        if (!dataString || typeof dataString !== 'string') {
          logger(
            `[fetchAll/actors] [fetchAllBinaryData] invalid dataString for transaction ${transactionId}`,
          )
          continue
        }

        const dataUint8Array = await BaseArweaveClient.getTransactionData(transactionId)
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
          const url = dataString
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
            BaseFileManager.getFilesPath('images', transactionId),
            bufferUint8Array,
            {
              encoding: 'binary',
            },
          )

          continue
        }

        let mimeType = getMimeType(dataString)
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


          await fs.promises.writeFile(BaseFileManager.getFilesPath('images', fileName), binaryData, {
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
          await fs.promises.writeFile(BaseFileManager.getFilesPath('html', fileName), dataString)
        }

        if (contentType === 'json') {
          fileName += '.json'
          await fs.promises.writeFile(BaseFileManager.getFilesPath('json', fileName), dataString)
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
