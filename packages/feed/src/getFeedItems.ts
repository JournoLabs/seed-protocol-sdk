import {
  queryBySchema,
  queryBySchemaForMonth,
  getArweaveUrlForTransaction,
  type SeedRecord,
} from '@seedprotocol/query'
import { initializeFeedPlatform } from './bootstrap'
import { loadFeedConfig } from './config'

type SetFeedItemDefaultsOptions = {
  itemUrlBase?: string
  itemUrlPath: string
  siteUrl: string
}

const formatRfc822Date = (timestamp: number): string => {
  const date = new Date(timestamp * 1000)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const day = days[date.getUTCDay()]
  const month = months[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  const dayNum = date.getUTCDate().toString().padStart(2, '0')
  const hours = date.getUTCHours().toString().padStart(2, '0')
  const minutes = date.getUTCMinutes().toString().padStart(2, '0')
  const seconds = date.getUTCSeconds().toString().padStart(2, '0')

  return `${day}, ${dayNum} ${month} ${year} ${hours}:${minutes}:${seconds} GMT`
}

const getCollectionPath = (schemaName: string): string => {
  return schemaName === 'image'
    ? 'images'
    : schemaName === 'post'
      ? 'posts'
      : schemaName.toLowerCase() + 's'
}

/**
 * Set default values for feed items (title, link, guid, pubDate, dual-case keys).
 */
export const setFeedItemDefaults = (
  item: Record<string, unknown>,
  seedUid: string,
  schemaName: string,
  options: SetFeedItemDefaultsOptions,
): void => {
  const { itemUrlBase, itemUrlPath, siteUrl } = options

  if (!item.title && !item.Title) {
    item.title = seedUid
    item.Title = seedUid
  } else if (item.title && !item.Title) {
    item.Title = item.title
  } else if (item.Title && !item.title) {
    item.title = item.Title
  }

  const storageTransactionIdSnake =
    item.storage_transaction_id &&
    typeof item.storage_transaction_id === 'string' &&
    item.storage_transaction_id.trim() !== '' &&
    item.storage_transaction_id !== 'undefined' &&
    item.storage_transaction_id !== seedUid
      ? (item.storage_transaction_id as string).trim()
      : null
  const storageTransactionIdCamel =
    item.storageTransactionId &&
    typeof item.storageTransactionId === 'string' &&
    item.storageTransactionId.trim() !== '' &&
    item.storageTransactionId !== 'undefined' &&
    item.storageTransactionId !== seedUid
      ? (item.storageTransactionId as string).trim()
      : null
  const storageTransactionId = storageTransactionIdSnake || storageTransactionIdCamel

  const collectionPath = getCollectionPath(schemaName)
  const validSeedUid =
    seedUid && typeof seedUid === 'string' && seedUid.trim() !== '' ? seedUid : 'unknown'

  let defaultLink: string
  if (storageTransactionId && storageTransactionId !== seedUid && storageTransactionId.length > 0) {
    try {
      defaultLink = getArweaveUrlForTransaction(storageTransactionId)
    } catch (error) {
      console.error('[feed] [setFeedItemDefaults] Error generating Arweave URL:', error)
      if (itemUrlBase != null) {
        defaultLink = `${itemUrlBase.replace(/\/$/, '')}/${(itemUrlPath ?? 'attestation/view').replace(/^\//, '')}/${validSeedUid}`
      } else {
        defaultLink = `${siteUrl.replace(/\/$/, '')}/${collectionPath}/${validSeedUid}`
      }
    }
  } else {
    if (itemUrlBase != null) {
      defaultLink = `${itemUrlBase.replace(/\/$/, '')}/${(itemUrlPath ?? 'attestation/view').replace(/^\//, '')}/${validSeedUid}`
    } else {
      defaultLink = `${siteUrl.replace(/\/$/, '')}/${collectionPath}/${validSeedUid}`
    }
  }

  const currentLink = (item.link || item.Link) as string | undefined
  if (
    !currentLink ||
    currentLink === 'undefined' ||
    (typeof currentLink === 'string' && currentLink.trim() === '')
  ) {
    item.link = defaultLink
    item.Link = defaultLink
  } else {
    if (!item.link || item.link === 'undefined') {
      item.link = currentLink
    }
    if (!item.Link || item.Link === 'undefined') {
      item.Link = currentLink
    }
  }

  const currentGuid = (item.guid || item.Guid) as string | undefined
  if (
    !currentGuid ||
    currentGuid === 'undefined' ||
    (typeof currentGuid === 'string' && currentGuid.trim() === '')
  ) {
    item.guid = item.link || defaultLink
    item.Guid = item.guid
  } else {
    if (!item.guid || item.guid === 'undefined') {
      item.guid = currentGuid
    }
    if (!item.Guid || item.Guid === 'undefined') {
      item.Guid = currentGuid
    }
  }

  if (item.timeCreated && !item.pubDate && !item.PubDate) {
    const pubDate = formatRfc822Date(item.timeCreated as number)
    item.pubDate = pubDate
    item.PubDate = pubDate
  } else if (item.pubDate && !item.PubDate) {
    item.PubDate = item.pubDate
  } else if (item.PubDate && !item.pubDate) {
    item.pubDate = item.PubDate
  }

  if (!item.seedUid && !item.SeedUid) {
    item.seedUid = seedUid
    item.SeedUid = seedUid
  } else if (item.seedUid && !item.SeedUid) {
    item.SeedUid = item.seedUid
  } else if (item.SeedUid && !item.seedUid) {
    item.seedUid = item.SeedUid
  }

  if (item.attester && !item.Attester) {
    item.Attester = item.attester
  } else if (item.Attester && !item.attester) {
    item.attester = item.Attester
  }
}

function looksLikeSeedClone(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rec = value as Record<string, unknown>
  return typeof rec.seedUid === 'string' || typeof rec.SeedUid === 'string'
}

/**
 * Apply feed defaults to a root item and nested expanded seed clones.
 */
function applyFeedDefaultsDeep(
  item: Record<string, unknown>,
  schemaName: string,
  options: SetFeedItemDefaultsOptions,
): void {
  const seedUid = (item.seedUid || item.SeedUid || '') as string
  setFeedItemDefaults(item, seedUid, schemaName, options)

  for (const key of Object.keys(item)) {
    if (key.startsWith('_')) continue
    const value = item[key]
    if (Array.isArray(value)) {
      for (const el of value) {
        if (looksLikeSeedClone(el)) {
          const nestedUid = (el.seedUid || el.SeedUid || '') as string
          const nestedSchema =
            typeof el.schemaName === 'string' ? el.schemaName : schemaName
          setFeedItemDefaults(el, nestedUid, nestedSchema, options)
        }
      }
    } else if (looksLikeSeedClone(value)) {
      const nestedUid = (value.seedUid || value.SeedUid || '') as string
      const nestedSchema =
        typeof value.schemaName === 'string' ? value.schemaName : schemaName
      setFeedItemDefaults(value, nestedUid, nestedSchema, options)
    }
  }
}

function seedRecordsToFeedItems(
  schemaName: string,
  records: SeedRecord[],
): Record<string, unknown>[] {
  const feedConfig = loadFeedConfig()
  const defaultsOptions: SetFeedItemDefaultsOptions = {
    itemUrlBase: feedConfig.itemUrlBase,
    itemUrlPath: feedConfig.itemUrlPath,
    siteUrl: feedConfig.siteUrl,
  }

  return records.map((record) => {
    const item = record.data
    applyFeedDefaultsDeep(item, schemaName, defaultsOptions)
    return item
  })
}

export const getFeedItemsBySchemaName = async (
  schemaName: string,
  options?: { limit?: number; skip?: number },
): Promise<Record<string, unknown>[]> => {
  await initializeFeedPlatform()
  const feedConfig = loadFeedConfig()
  const limit = options?.limit ?? 100
  const skip = options?.skip ?? 0

  const { items } = await queryBySchema(schemaName, {
    limit,
    skip,
    expandRelations: feedConfig.expandRelations !== false,
    hydrateStorage: true,
  })
  return seedRecordsToFeedItems(schemaName, items)
}

export const getFeedItemsBySchemaNameForMonth = async (
  schemaName: string,
  year: number,
  month: number,
): Promise<Record<string, unknown>[]> => {
  await initializeFeedPlatform()
  const feedConfig = loadFeedConfig()

  const records = await queryBySchemaForMonth(schemaName, year, month, {
    expandRelations: feedConfig.expandRelations !== false,
    hydrateStorage: true,
  })
  return seedRecordsToFeedItems(schemaName, records)
}
