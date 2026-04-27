import { eventEmitter } from '@/eventBus'
import { appState } from '@/seedSchema'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { getAllAddressesFromDb } from '@/helpers/db'
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
import { metadata } from '@/seedSchema'
import { BaseEasClient, BaseQueryClient, BaseArweaveClient, ensureReadGatewaySelected } from '@/helpers'
import { supportsOpfsFileDownloads } from '@/helpers/environment'
import { Endpoints } from '@/types'
import { throttle } from 'lodash-es'


const logger = debug('seedSdk:files:download')
const AUTO_BULK_DOWNLOAD_THROTTLE_MS = 10000
/** Avoid refetch-on-every-call: transient empty indexer responses were overwriting good cache (see trailing throttle ~10s after success). */
const GET_FILES_METADATA_STALE_MS = 120_000
let bulkDownloadInFlight: Promise<void> | null = null
const lazyDownloadInFlightByTransactionId = new Map<string, Promise<boolean>>()

// syncDbFiles helper - internal service removed, functionality moved here
const syncDbFiles = async (endpoints: any) => {
  // TODO: Implement syncDbFiles functionality if needed
  // This was previously in @/services/internal/helpers
  logger('[download] syncDbFiles called but not yet implemented')
  return Promise.resolve()
}

const getAppDbReady = async () => {
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
  }

  return BaseDb.getAppDb()
}

const getExcludedTransactions = async (): Promise<Set<string>> => {
  const appDb = await getAppDbReady()
  if (!appDb) {
    return new Set<string>()
  }

  const excludedTransactionsQuery = await appDb
    .select()
    .from(appState)
    .where(eq(appState.key, 'excludedTransactions'))

  const excludedTransactions = new Set<string>()
  if (excludedTransactionsQuery && excludedTransactionsQuery.length === 1) {
    const valueString = excludedTransactionsQuery[0].value
    if (valueString) {
      const excludedTransactionsArray = JSON.parse(valueString)
      for (const txId of excludedTransactionsArray) {
        excludedTransactions.add(txId)
      }
    }
  }
  return excludedTransactions
}

/** Arweave transaction ids are 43 chars in the URL-safe base64 alphabet. */
const ARWEAVE_TX_ID_RE = /^[a-z0-9_-]{43}$/i

const normalizeArweaveTxId = (raw: string | null | undefined): string | undefined => {
  if (raw == null || raw === '') return undefined
  const t = String(raw).trim()
  if (ARWEAVE_TX_ID_RE.test(t)) return t
  const m = t.match(/^([a-z0-9_-]{43})(?:\.[^/]+)?$/i)
  if (m) return m[1]
  // Values may be full gateway URLs or paths; scan for the embedded tx id.
  const embedded = t.match(/[a-z0-9_-]{43}/gi)
  if (embedded) {
    for (const candidate of embedded) {
      if (ARWEAVE_TX_ID_RE.test(candidate)) return candidate
    }
  }
  return undefined
}

const mergeAddressLists = (a: string[] | undefined, b: string[] | undefined): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const addr of [...(a ?? []), ...(b ?? [])]) {
    if (!addr || !addr.trim()) continue
    const k = addr.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(addr)
  }
  return out
}

const collectTransactionIdsFromLocalMetadata = async (): Promise<string[]> => {
  const appDb = await getAppDbReady()
  if (!appDb) {
    return []
  }

  const nameOr = or(
    eq(metadata.propertyName, 'storageTransactionId'),
    eq(metadata.propertyName, 'storage_transaction_id'),
    eq(metadata.propertyName, 'transactionId'),
  )

  const propRows = await appDb
    .select({ propertyValue: metadata.propertyValue })
    .from(metadata)
    .where(and(nameOr, isNotNull(metadata.propertyValue)))

  const refRows = await appDb
    .select({ refResolvedValue: metadata.refResolvedValue })
    .from(metadata)
    .where(isNotNull(metadata.refResolvedValue))

  const ids = new Set<string>()
  for (const row of propRows) {
    const id = normalizeArweaveTxId(row.propertyValue ?? undefined)
    if (id) ids.add(id)
  }
  for (const row of refRows) {
    const id = normalizeArweaveTxId(row.refResolvedValue ?? undefined)
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

const parseTransactionIdsFromMetadata = (filesMetadata: any[], excludedTransactions: Set<string>): string[] => {
  const transactionIds: string[] = []

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

    const rawTx = json[0].value.value
    if (typeof rawTx !== 'string' || rawTx.trim().length === 0) {
      continue
    }
    const transactionId = normalizeArweaveTxId(rawTx.trim())
    if (!transactionId) {
      continue
    }
    if (excludedTransactions.has(transactionId) || excludedTransactions.has(rawTx.trim())) {
      continue
    }
    transactionIds.push(transactionId)
  }

  return transactionIds
}

const downloadTransactionIds = async (
  rawTransactionIds: string[],
  options?: { resizeAllImages?: boolean },
): Promise<boolean> => {
  if (!supportsOpfsFileDownloads()) {
    return false
  }

  const transactionIds = Array.from(new Set(rawTransactionIds.filter((tx) => !!tx && tx.trim().length > 0)))
  if (transactionIds.length === 0) {
    return false
  }

  const excludedTransactions = await getExcludedTransactions()
  const queryClient = BaseQueryClient.getQueryClient()

  const transactionIdsToDownload: string[] = []
  let excludedChanged = false

  await ensureReadGatewaySelected()

  for (const transactionId of transactionIds) {
    if (excludedTransactions.has(transactionId)) {
      continue
    }

    try {
      // Browser: do not call getTransactionStatus() — many gateways (e.g. g8way.io) redirect or omit
      // CORS headers, so fetch() fails and we would wrongly exclude txs. The OPFS worker fetch decides success.

      let tags: { name: string; value: string }[] = []
      try {
        tags = await queryClient.fetchQuery({
          queryKey: ['getTransactionTags', transactionId],
          queryFn: async () => BaseArweaveClient.getTransactionTags(transactionId),
        })
      } catch {
        tags = []
      }

      if (tags && tags.length > 0) {
        for (const { name, value } of tags) {
          if (name !== 'Content-SHA-256') continue
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

      transactionIdsToDownload.push(transactionId)
    } catch (error) {
      logger(error)
    }
  }

  if (excludedChanged) {
    await saveAppState(
      'excludedTransactions',
      JSON.stringify(Array.from(excludedTransactions)),
    )
  }

  if (transactionIdsToDownload.length === 0) {
    return false
  }

  if (transactionIdsToDownload.length === 1) {
    await BaseFileManager.downloadFileByTransactionId({
      transactionId: transactionIdsToDownload[0],
      arweaveHost: BaseArweaveClient.getHost(),
      excludedTransactions,
    })
  } else {
    await BaseFileManager.downloadAllFiles({
      transactionIds: transactionIdsToDownload,
      arweaveHost: BaseArweaveClient.getHost(),
      excludedTransactions,
    })
  }

  if (options?.resizeAllImages !== false) {
    await BaseFileManager.resizeAllImages({
      width: 480,
      height: 480,
    })
  }

  return true
}

const runBulkDownloadWithDedupe = async (transactionIds: string[]): Promise<void> => {
  if (bulkDownloadInFlight) {
    return bulkDownloadInFlight
  }

  bulkDownloadInFlight = (async () => {
    try {
      await downloadTransactionIds(transactionIds, { resizeAllImages: true })
    } finally {
      bulkDownloadInFlight = null
    }
  })()

  return bulkDownloadInFlight
}


type DownloadAllFilesRequestHandlerProps = {
  endpoints: Endpoints
  eventId: string
}

export const downloadAllFilesRequestHandler = async ({
  endpoints,
  eventId,
}: DownloadAllFilesRequestHandlerProps) => {

  if (!supportsOpfsFileDownloads()) {
    return
  }

  await syncDbFiles(endpoints)

  eventEmitter.emit('fs.downloadAll.success', { eventId })
  eventEmitter.emit('fs.downloadAllBinary.request', { endpoints })
}

export const downloadAllFilesBinaryRequestHandler = async (
  addressesHintOrPayload?: string[] | { endpoints?: Endpoints },
) => {
  if (!supportsOpfsFileDownloads()) {
    return
  }

  const addressesHint = Array.isArray(addressesHintOrPayload)
    ? addressesHintOrPayload
    : undefined

  let fromDb: string[] = []
  if (BaseDb.isAppDbReady()) {
    fromDb = await getAllAddressesFromDb()
  }

  if (!BaseDb.isAppDbReady()) {
    await getAppDbReady()
    fromDb = await getAllAddressesFromDb()
  }

  const addresses = mergeAddressLists(addressesHint, fromDb)

  if (!addresses || addresses.length === 0) {
    return
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const filesMetadataQueryKey = ['getFilesMetadata', ...addresses] as const
  const fetchFilesMetadata = () =>
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
    })

  let { filesMetadata } = await queryClient.fetchQuery({
    queryKey: filesMetadataQueryKey,
    queryFn: fetchFilesMetadata,
    staleTime: GET_FILES_METADATA_STALE_MS,
  })

  if ((!Array.isArray(filesMetadata) || filesMetadata.length === 0) && addresses.length > 0) {
    await queryClient.removeQueries({ queryKey: filesMetadataQueryKey })
    ;({ filesMetadata } = await queryClient.fetchQuery({
      queryKey: filesMetadataQueryKey,
      queryFn: fetchFilesMetadata,
      staleTime: GET_FILES_METADATA_STALE_MS,
    }))
  }

  const filesRoot = BaseFileManager.getWorkingDir()
  await BaseFileManager.createDirIfNotExists(filesRoot)
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('html'))
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('json'))
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('images'))

  const excludedTransactions = await getExcludedTransactions()
  const fromEas = parseTransactionIdsFromMetadata(filesMetadata ?? [], excludedTransactions)
  const fromLocal = await collectTransactionIdsFromLocalMetadata()
  const transactionIds = Array.from(new Set([...fromEas, ...fromLocal]))
  await runBulkDownloadWithDedupe(transactionIds)
}

export const downloadTransactionIdWithDedupe = async (transactionId: string): Promise<boolean> => {
  if (!supportsOpfsFileDownloads() || !transactionId || transactionId.trim().length === 0) {
    return false
  }

  const normalizedTxId = normalizeArweaveTxId(transactionId) ?? transactionId.trim()

  const existing = lazyDownloadInFlightByTransactionId.get(normalizedTxId)
  if (existing) {
    return existing
  }

  const inFlight = (async () => {
    try {
      const ok = await downloadTransactionIds([normalizedTxId], { resizeAllImages: false })
      return ok
    } finally {
      lazyDownloadInFlightByTransactionId.delete(normalizedTxId)
    }
  })()

  lazyDownloadInFlightByTransactionId.set(normalizedTxId, inFlight)
  return inFlight
}

const scheduleBulkFilesDownloadFromEasSyncThrottled = throttle((addressesHint?: string[]) => {
  void downloadAllFilesBinaryRequestHandler(addressesHint).catch((error) => {
    logger('[scheduleBulkFilesDownloadFromEasSync] failed', error)
  })
}, AUTO_BULK_DOWNLOAD_THROTTLE_MS, { leading: true, trailing: false })

export const scheduleBulkFilesDownloadFromEasSync = (addressesHint?: string[]): void => {
  if (!supportsOpfsFileDownloads()) {
    return
  }
  scheduleBulkFilesDownloadFromEasSyncThrottled(addressesHint)
}
