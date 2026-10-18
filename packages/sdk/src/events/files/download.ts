import { eventEmitter } from '@/eventBus'
import { appState } from '@/seedSchema'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { getAllAddressesFromDb } from '@/helpers/db'
import {
  BaseFileManager,
} from '@/helpers'
import { GET_FILES_METADATA } from '@seedprotocol/eas'
import debug from 'debug'
// Dynamic import to break circular dependency with globalMachine
// import { getGlobalService } from '@/services/global/globalMachine'
import { waitFor } from 'xstate'
import { getMetadata } from '@/db/read/getMetadata'
import { saveMetadata } from '@/db/write/saveMetadata'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { BaseEasClient, BaseQueryClient, BaseArweaveClient, ensureReadGatewaySelected } from '@/helpers'
import { getArweaveReadBaseUrls } from '@/helpers/gateway/gatewayState'
import { supportsOpfsFileDownloads } from '@/helpers/environment'
import { Endpoints } from '@/types'
import type { TransactionTag } from '@/types/arweave'
import { getTransactionTagsByIds } from '@seedprotocol/arweave'
import { CONTENT_SHA256_TAG } from '@/helpers/arweaveContentTags'
import { getCompositeChildPaths } from '@/db/read/getCompositeChildPaths'
import { throttle } from 'lodash-es'


const logger = debug('seedSdk:files:download')
const AUTO_BULK_DOWNLOAD_THROTTLE_MS = 10000
/** Avoid refetch-on-every-call: transient empty indexer responses were overwriting good cache (see trailing throttle ~10s after success). */
const GET_FILES_METADATA_STALE_MS = 120_000
let bulkDownloadInFlight: Promise<void> | null = null
const lazyDownloadInFlightByTransactionId = new Map<string, Promise<boolean>>()

// syncDbFiles helper - internal service removed, functionality moved here
const syncDbFiles = async (_endpoints: any) => {
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
  // Values may be full gateway URLs or paths; scan for an embedded tx id. It must be 43 characters
  // on its own, not the start of a longer run: the first 43 of a bytes32 value (`0x0000…0020`,
  // an EAS UID) are in the alphabet too.
  const embedded = t.match(/(?<![a-z0-9_-])[a-z0-9_-]{43}(?![a-z0-9_-])/gi)
  return embedded?.[0]
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

/** Content-SHA-256 tag values for the transactions that have one, from one batched tag lookup (cached). */
const getExpectedContentHashes = async (transactionIds: string[]): Promise<Record<string, string>> => {
  const queryClient = BaseQueryClient.getQueryClient()
  const tagsById = new Map<string, TransactionTag[]>()
  const toFetch: string[] = []
  for (const transactionId of transactionIds) {
    // Tags never change once a transaction is indexed, so a cached lookup stays good.
    const cached = queryClient.getQueryData?.(['getTransactionTags', transactionId]) as TransactionTag[] | undefined
    if (cached) tagsById.set(transactionId, cached)
    else toFetch.push(transactionId)
  }

  if (toFetch.length > 0) {
    try {
      const fetched = await getTransactionTagsByIds(toFetch, {
        client: BaseArweaveClient.getArweaveClient(),
        onError: (error: unknown) => logger('[download] transaction tags lookup failed', error),
      })
      for (const [transactionId, tags] of fetched) {
        tagsById.set(transactionId, tags)
        // Seed the per-transaction cache entry (the client interface has no setQueryData).
        void queryClient
          .fetchQuery({ queryKey: ['getTransactionTags', transactionId], queryFn: async () => tags })
          .catch(() => {})
      }
    } catch (error) {
      logger('[download] transaction tags lookup failed', error)
    }
  }

  const out: Record<string, string> = {}
  for (const [transactionId, tags] of tagsById) {
    const value = tags.find((tag) => tag.name === CONTENT_SHA256_TAG)?.value?.trim()
    if (value) out[transactionId] = value
  }
  return out
}

/** Store the (now verified) Content-SHA-256 of each downloaded transaction on its metadata row. */
const recordVerifiedContentHashes = async (
  transactionIds: string[],
  expectedContentHashes: Record<string, string>,
): Promise<void> => {
  for (const transactionId of transactionIds) {
    const contentHash = expectedContentHashes[transactionId]
    if (!contentHash) continue
    try {
      const metadataRecord = await getMetadata({ storageTransactionId: transactionId })
      if (metadataRecord) {
        await saveMetadata(metadataRecord, { contentHash })
      }
    } catch (error) {
      logger(error)
    }
  }
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

  await ensureReadGatewaySelected()

  // Browser: do not call getTransactionStatus() — many gateways (e.g. g8way.io) redirect or omit
  // CORS headers, so fetch() fails and we would wrongly exclude txs. The OPFS worker fetch decides success.
  const transactionIdsToDownload = transactionIds.filter((id) => !excludedTransactions.has(id))
  if (transactionIdsToDownload.length === 0) {
    return false
  }

  // One batched lookup for every upload's Content-SHA-256 tag; downloads are verified against it.
  // Missing tags (old uploads, or a just-published one not indexed yet) just mean no verification.
  const expectedContentHashes = await getExpectedContentHashes(transactionIdsToDownload)

  // Preferred gateways first: a just-published item is only on the gateway it was uploaded through.
  const arweaveBaseUrls = getArweaveReadBaseUrls()

  // Where each ItemStorage child of a composite goes (the worker cannot read the DB or the schema).
  const compositeChildPaths = await getCompositeChildPaths(transactionIdsToDownload).catch((error) => {
    logger('[download] composite child paths lookup failed', error)
    return {} as Record<string, Record<string, string>>
  })

  let result: DownloadAllFilesResult | void
  if (transactionIdsToDownload.length === 1) {
    const transactionId = transactionIdsToDownload[0]
    result = await BaseFileManager.downloadFileByTransactionId({
      transactionId,
      arweaveHost: BaseArweaveClient.getBaseUrl(),
      arweaveBaseUrls,
      excludedTransactions,
      expectedContentHash: expectedContentHashes[transactionId],
      compositeChildPaths: compositeChildPaths[transactionId],
    })
  } else {
    result = await BaseFileManager.downloadAllFiles({
      transactionIds: transactionIdsToDownload,
      arweaveHost: BaseArweaveClient.getBaseUrl(),
      arweaveBaseUrls,
      excludedTransactions,
      expectedContentHashes,
      compositeChildPaths,
    })
  }

  if (result) {
    for (const transactionId of result.hashMismatchTransactionIds) {
      // Not saved by the worker; left for a later run (a gateway may serve the right bytes then).
      logger(`[download] ${transactionId}: downloaded bytes do not match Content-SHA-256; skipped`)
    }
    await recordVerifiedContentHashes(result.verifiedTransactionIds, expectedContentHashes)
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
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('files'))

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

  const normalizedTxId = normalizeArweaveTxId(transactionId)
  if (!normalizedTxId) {
    logger(`[download] not an Arweave transaction id: ${transactionId}`)
    return false
  }

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
