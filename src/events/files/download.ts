import { syncDbFiles } from '@/services/internal/helpers'
import { eventEmitter } from '@/eventBus'
import fs from '@zenfs/core'
import { ARWEAVE_HOST } from '@/services/internal/constants'
import { appState } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getAddressesFromDb } from '@/helpers/db'
import {
  BaseFileManager,
} from '@/helpers'
import { GET_FILES_METADATA } from '@/schema/file/queries'
import debug from 'debug'
import { getGlobalService } from '@/services'
import { waitFor } from 'xstate'
import { getMetadata } from '@/db/read/getMetadata'
import { saveMetadata } from '@/db/write/saveMetadata'
import { GET_TRANSACTION_TAGS } from '@/helpers/ArweaveClient/queries'
import { saveAppState } from '@/db/write/saveAppState'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient, BaseQueryClient, BaseArweaveClient } from '@/helpers'
import { getArweave } from '@/helpers/ArweaveClient'


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
      await waitFor(internalService, (snapshot) => {
        return snapshot.value === 'ready'
      })
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

  await BaseFileManager.createDirIfNotExists('/files')
  await BaseFileManager.createDirIfNotExists('/files/html')
  await BaseFileManager.createDirIfNotExists('/files/json')
  await BaseFileManager.createDirIfNotExists('/files/images')

  const appDb = BaseDb.getAppDb()

  if (!appDb) {
    console.warn('[fetchAll/actors] [fetchAllBinaryData] seedDb not available')
    return []
  }

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

  const transactionIds = []

  for (const fileMetadata of filesMetadata) {
    const json = JSON.parse(fileMetadata.decodedDataJson)
    const transactionId = json[0].value.value
    if (excludedTransactions.has(transactionId)) {
      continue
    }
    transactionIds.push(transactionId)
  }

  const arweave = getArweave()

  if (!arweave) {
    console.warn(
      '[fetchAll/actors] [fetchAllBinaryData] arweave not available',
    )
    return []
  }

  const arweaveClient = BaseArweaveClient.getArweaveClient()

  const transactionIdsToDownload = []

  for (const transactionId of transactionIds) {

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

      transactionIdsToDownload.push(transactionId)

    

    } catch (error) {
      logger(error)
    }
  }

  console.log('[download] Calling downloadAllFiles with transactionIdsToDownload', transactionIdsToDownload)

  await BaseFileManager.downloadAllFiles({
    transactionIds: transactionIdsToDownload,
    arweaveHost: ARWEAVE_HOST,
    excludedTransactions,
  })

  await BaseFileManager.resizeAllImages({
    width: 480,
    height: 480,
  })
}
