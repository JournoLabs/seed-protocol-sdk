import { syncDbFiles } from '@/services/internal/helpers'
import { eventEmitter } from '@/eventBus'
import { fs } from '@zenfs/core'
import { ARWEAVE_HOST } from '@/services/internal/constants'
import { appState } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getArweave } from '@/browser/schema/file'
import { getAddressesFromDb } from '@/helpers/db'
import {
  getDataTypeFromString,
  getMimeType,
  identifyString,
} from '@/helpers'
import { GET_FILES_METADATA } from '@/browser/schema/file/queries'
import debug from 'debug'
import { getGlobalService } from '@/services'
import { waitFor } from 'xstate'
import { getMetadata } from '@/db/read/getMetadata'
import { saveMetadata } from '@/db/write/saveMetadata'
import { GET_TRANSACTION_TAGS } from '@/browser/arweave/queries'
import { saveAppState } from '@/db/write/saveAppState'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient, BaseQueryClient, BaseArweaveClient } from '@/helpers'


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

  if (BaseDb.isAppDbReady()) {
    addresses = await getAddressesFromDb()
  }

  if (!BaseDb.isAppDbReady()) {
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

        await saveAppState(
          'excludedTransactions',
          JSON.stringify(Array.from(excludedTransactions)),
        )

        continue
      }

      if (transactionId === 'ZXnDkNk_PHRl5Yqu90kEJn_R3LS3Tl9P8eLtlJTqB-M') {
        console.log('transactionId', transactionId)
      }

      const arweaveClient = BaseArweaveClient.getArweaveClient()

      const { tags: tagsResult } = await queryClient.fetchQuery({
        queryKey: ['getTransactionTags', transactionId],
        queryFn: async () =>
          arweaveClient.request(GET_TRANSACTION_TAGS, {
            transactionId,
          }),
      })

      const tags = tagsResult.tags || []

      if (tagsResult.tags && tagsResult.tags.length > 0) {
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

      const data = await queryClient.fetchQuery({
        queryKey: ['fetchTransaction', transactionId],
        queryFn: async () => {
          const response = await fetch(
            `https://${ARWEAVE_HOST}/raw/${transactionId}`,
          )

          const responseContentType = response.headers.get('Content-Type')

          console.log('Content type', responseContentType)

          if (responseContentType === 'application/octet-stream') {
            return await response.arrayBuffer()
          }

          return await response.text()
        },
        networkMode: 'offlineFirst',
      })

      let dataString
      let arrayBuffer

      if (data instanceof ArrayBuffer) {
        arrayBuffer = data
      }

      if (typeof data === 'string') {
        dataString = data
      }

      // const dataString = await arweave.transactions.getData(transactionId, {
      //   decode: true,
      //   string: true,
      // })

      if (!dataString && !arrayBuffer) {
        logger(
          `[fetchAll/actors] [fetchAllBinaryData] transaction ${transactionId} data not found`,
        )
      }

      if (dataString && dataString.startsWith('===FILE_SEPARATOR===')) {
        const dataStringParts = dataString
          .split('===FILE_SEPARATOR===')
          .slice(1)

        if (dataStringParts.length % 2 !== 0) {
          throw new Error('Input array must have an even number of elements.')
        }

        for (let i = 0; i < dataStringParts.length; i += 2) {
          const contentType = dataStringParts[i]
          const content = dataStringParts[i + 1]
          if (contentType === 'html') {
            const fileName = `${transactionId}.html`
            await fs.promises.writeFile(`/files/html/${fileName}`, content)
          }
          if (contentType === 'json') {
            const fileName = `${transactionId}.json`
            await fs.promises.writeFile(`/files/json/${fileName}`, content)
          }
        }

        continue
      }

      if (!dataString && arrayBuffer) {
        await fs.promises.writeFile(
          `/files/images/${transactionId}`,
          new Uint8Array(arrayBuffer),
        )
        continue
      }

      if (!dataString) {
        continue
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
      let fileExtension = mimeType

      if (fileExtension && fileExtension?.startsWith('image')) {
        fileExtension = fileExtension.replace('image/', '')
      }

      let fileName = transactionId

      if (contentType === 'base64') {
        if (fileExtension) {
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
