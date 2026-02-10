import { eventEmitter } from '@/eventBus'
import { appState } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getAddressesFromDb } from '@/helpers/db'
import {
  BaseFileManager,
} from '@/helpers'
import { GET_FILES_METADATA } from '@/helpers/file/queries'
import debug from 'debug'
// Dynamic import to break circular dependency with globalMachine
// import { getGlobalService } from '@/services/global/globalMachine'
import { waitFor } from 'xstate'
import { getMetadata } from '@/db/read/getMetadata'
import { saveMetadata } from '@/db/write/saveMetadata'
import { saveAppState } from '@/db/write/saveAppState'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient, BaseQueryClient, BaseArweaveClient } from '@/helpers'
import { isBrowser } from '@/helpers/environment'
import { Endpoints } from '@/types'


const logger = debug('seedSdk:files:download')

// syncDbFiles helper - internal service removed, functionality moved here
const syncDbFiles = async (endpoints: any) => {
  // TODO: Implement syncDbFiles functionality if needed
  // This was previously in @/services/internal/helpers
  logger('[download] syncDbFiles called but not yet implemented')
  return Promise.resolve()
}


type DownloadAllFilesRequestHandlerProps = {
  endpoints: Endpoints
  eventId: string
}

export const downloadAllFilesRequestHandler = async ({
  endpoints,
  eventId,
}: DownloadAllFilesRequestHandlerProps) => {

  if (!isBrowser()) {
    return
  }

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
    // Wait for ClientManager to be ready (DB_INIT state or later)
    const clientManagerMod = await import('../../client/ClientManager')
    const { getClient } = clientManagerMod
    const clientManager = getClient()
    const clientService = clientManager.getService()
    
    await waitFor(clientService, (snapshot) => {
      const state = snapshot.value
      return state === 'dbInit' || 
             state === 'saveConfig' ||
             state === 'processSchemaFiles' ||
             state === 'addModelsToStore' ||
             state === 'addModelsToDb' ||
             state === 'idle'
    }, { timeout: 30000 })
    addresses = await getAddressesFromDb()
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
    // Validate and parse decodedDataJson
    if (!fileMetadata.decodedDataJson || fileMetadata.decodedDataJson.trim() === '') {
      console.warn(
        '[events/files] [download] empty decodedDataJson for fileMetadata: ',
        fileMetadata.id,
      )
      continue
    }

    let json
    try {
      json = JSON.parse(fileMetadata.decodedDataJson)
    } catch (error) {
      console.warn(
        '[events/files] [download] failed to parse decodedDataJson for fileMetadata: ',
        fileMetadata.id,
        error,
      )
      continue
    }

    if (!Array.isArray(json) || json.length === 0 || !json[0]?.value?.value) {
      console.warn(
        '[events/files] [download] invalid decodedDataJson structure for fileMetadata: ',
        fileMetadata.id,
      )
      continue
    }

    const transactionId = json[0].value.value
    if (excludedTransactions.has(transactionId)) {
      continue
    }
    transactionIds.push(transactionId)
  }

  const transactionIdsToDownload = []

  for (const transactionId of transactionIds) {

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

        continue
      }
      
      // Use BaseArweaveClient for getting transaction tags
      const tags = await queryClient.fetchQuery({
        queryKey: ['getTransactionTags', transactionId],
        queryFn: async () => BaseArweaveClient.getTransactionTags(transactionId),
      })

      if (tags && tags.length > 0) {
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

  await BaseFileManager.downloadAllFiles({
    transactionIds: transactionIdsToDownload,
    arweaveHost: BaseArweaveClient.getHost(),
    excludedTransactions,
  })

  await BaseFileManager.resizeAllImages({
    width: 480,
    height: 480,
  })
}
