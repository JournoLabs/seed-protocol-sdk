import { syncDbFiles } from '@/browser/services/internal/helpers'
import { eventEmitter } from '@/eventBus'
import { fs } from '@zenfs/core'
import { ARWEAVE_HOST } from '@/browser/services/internal/constants'
import { appState } from 'src/shared/seedSchema'
import { eq } from 'drizzle-orm'
import { getArweave } from '@/browser/schema/file'
import { getAddressesFromDb } from '@/shared/helpers/db'
import {
  getDataTypeFromString,
  getMimeType,
  identifyString,
} from '@/shared/helpers'
import { arweaveClient, easClient, queryClient } from '@/browser/helpers'
import { GET_FILES_METADATA } from '@/browser/schema/file/queries'
import debug from 'debug'
import { getAppDb, isAppDbReady } from '@/browser/db/sqlWasmClient'
import { getGlobalService } from '@/browser/services'
import { waitFor } from 'xstate'
import { writeAppState } from '@/browser/db/write'
import { getMetadata } from '@/browser/db/read/getMetadata'
import { saveMetadata } from '@/browser/db/write/saveMetadata'
import { GET_TRANSACTION_TAGS } from '@/browser/arweave/queries'

const logger = debug('app:files:download')

export const downloadAllFilesRequestHandler = async ({
  endpoints,
  eventId,
}) => {
  await syncDbFiles(endpoints)

  eventEmitter.emit('fs.downloadAll.success', { eventId })
  eventEmitter.emit('fs.downloadAllBinary.request', { endpoints })
}

export const downloadAllFilesBinaryRequestHandler = async () => {
  let addresses: string[] | undefined

  if (isAppDbReady()) {
    addresses = await getAddressesFromDb()
  }

  if (!isAppDbReady()) {
    const globalService = getGlobalService()
    const internalService = globalService.getSnapshot().context.internalService
    if (internalService) {
      await waitFor(internalService, (snapshot) => snapshot.value === 'ready')
      addresses = await getAddressesFromDb()
    }
  }

  if (!addresses || addresses.length === 0) {
    return
  }

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

  const appDb = getAppDb()

  if (!appDb) {
    console.warn('[fetchAll/actors] [fetchAllBinaryData] seedDb not available')
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
      console.warn(
        '[fetchAll/actors] [fetchAllBinaryData] arweave not available',
      )
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

        await writeAppState(
          'excludedTransactions',
          JSON.stringify(Array.from(excludedTransactions)),
        )

        continue
      }

      const { tags } = await queryClient.fetchQuery({
        queryKey: ['getTransactionTags', transactionId],
        queryFn: async () =>
          arweaveClient.request(GET_TRANSACTION_TAGS, {
            transactionId,
          }),
      })

      if (tags && tags.length === 0) {
        for (const { name, value } of tags) {
          if (name === 'Content-SHA-256') {
            const metadataRecord = await getMetadata({
              storageTransactionId: transactionId,
            })

            if (metadataRecord) {
              await saveMetadata(metadataRecord, {
                contentHash: value,
              })
            }
          }
        }
      }

      const fetchResponse = await queryClient.fetchQuery({
        queryKey: ['fetchTransaction', transactionId],
        queryFn: async () =>
          fetch(`https://${ARWEAVE_HOST}/raw/${transactionId}`),
      })

      const dataString = await fetchResponse.text()

      // const dataString = await arweave.transactions.getData(transactionId, {
      //   decode: true,
      //   string: true,
      // })

      if (!dataString) {
        logger(
          `[fetchAll/actors] [fetchAllBinaryData] transaction ${transactionId} data not found`,
        )
      }

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
        const extensionMatch = url.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)
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

      const mimeType = getMimeType(dataString as string)

      let fileName = transactionId

      if (contentType === 'base64') {
        if (mimeType) {
          fileName += `.${mimeType}`
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
}
