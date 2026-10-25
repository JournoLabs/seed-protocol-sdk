import {
  queryBySchema,
  queryBySchemaForMonth,
  type SeedRecord,
} from '@seedprotocol/query'
import {
  buildArweaveTransactionLink,
  getPublicArweaveBaseUrl,
  getPublicArweaveRawUrl,
  parseArweaveTransactionLink,
  publishedArweaveLinksInHtml,
} from '@seedprotocol/arweave'
import { initializeFeedPlatform } from './bootstrap'
import { loadFeedConfig } from './config'

type SetFeedItemDefaultsOptions = {
  itemUrlBase: string
  itemUrlPath: string
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

/**
 * Set default values for feed items (title, link, guid, pubDate, dual-case keys).
 */
export const setFeedItemDefaults = (
  item: Record<string, unknown>,
  seedUid: string,
  schemaName: string,
  options: SetFeedItemDefaultsOptions,
): void => {
  const { itemUrlBase, itemUrlPath } = options

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

  const validSeedUid =
    seedUid && typeof seedUid === 'string' && seedUid.trim() !== '' ? seedUid : 'unknown'
  const attestationLink = `${itemUrlBase.replace(/\/$/, '')}/${itemUrlPath.replace(/^\//, '')}/${validSeedUid}`

  let defaultLink = attestationLink
  if (storageTransactionId && storageTransactionId !== seedUid && storageTransactionId.length > 0) {
    try {
      defaultLink = getPublicArweaveRawUrl(storageTransactionId)
    } catch (error) {
      console.error('[feed] [setFeedItemDefaults] Error generating Arweave URL:', error)
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

/**
 * Defaults for expanded Image relation clones in feeds.
 * Does not emit EAS attestation explorer URLs as `link` — only gateway URLs when storage exists.
 */
const setImageRelationCloneForFeed = (
  clone: Record<string, unknown>,
  seedUid: string,
): void => {
  if (!clone.title && !clone.Title) {
    clone.title = seedUid
    clone.Title = seedUid
  } else if (clone.title && !clone.Title) {
    clone.Title = clone.title
  } else if (clone.Title && !clone.title) {
    clone.title = clone.Title
  }

  if (clone.timeCreated && !clone.pubDate && !clone.PubDate) {
    const pubDate = formatRfc822Date(clone.timeCreated as number)
    clone.pubDate = pubDate
    clone.PubDate = pubDate
  } else if (clone.pubDate && !clone.PubDate) {
    clone.PubDate = clone.pubDate
  } else if (clone.PubDate && !clone.pubDate) {
    clone.pubDate = clone.PubDate
  }

  if (!clone.seedUid && !clone.SeedUid) {
    clone.seedUid = seedUid
    clone.SeedUid = seedUid
  } else if (clone.seedUid && !clone.SeedUid) {
    clone.SeedUid = clone.seedUid
  } else if (clone.SeedUid && !clone.seedUid) {
    clone.seedUid = clone.SeedUid
  }

  if (clone.attester && !clone.Attester) {
    clone.Attester = clone.attester
  } else if (clone.Attester && !clone.attester) {
    clone.attester = clone.Attester
  }

  const storageTransactionIdSnake =
    clone.storage_transaction_id &&
    typeof clone.storage_transaction_id === 'string' &&
    clone.storage_transaction_id.trim() !== '' &&
    clone.storage_transaction_id !== 'undefined' &&
    clone.storage_transaction_id !== seedUid
      ? (clone.storage_transaction_id as string).trim()
      : null
  const storageTransactionIdCamel =
    clone.storageTransactionId &&
    typeof clone.storageTransactionId === 'string' &&
    clone.storageTransactionId.trim() !== '' &&
    clone.storageTransactionId !== 'undefined' &&
    clone.storageTransactionId !== seedUid
      ? (clone.storageTransactionId as string).trim()
      : null
  const storageTransactionId = storageTransactionIdSnake || storageTransactionIdCamel

  delete clone.link
  delete clone.Link
  delete clone.guid
  delete clone.Guid

  if (storageTransactionId && storageTransactionId.length > 0) {
    try {
      const mediaLink = getPublicArweaveRawUrl(storageTransactionId)
      clone.link = mediaLink
      clone.Link = mediaLink
    } catch {
      // omit link when gateway URL cannot be built
    }
  }
}

function looksLikeSeedClone(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const rec = value as Record<string, unknown>
  return typeof rec.seedUid === 'string' || typeof rec.SeedUid === 'string'
}

function withNestedCloneDefaults(
  clone: Record<string, unknown>,
  parentSchemaName: string,
  options: SetFeedItemDefaultsOptions,
): Record<string, unknown> {
  const copy = { ...clone }
  const nestedUid = (copy.seedUid || copy.SeedUid || '') as string
  const nestedSchema =
    typeof copy.schemaName === 'string' ? copy.schemaName : parentSchemaName
  if (nestedSchema === 'image') {
    setImageRelationCloneForFeed(copy, nestedUid)
  } else {
    setFeedItemDefaults(copy, nestedUid, nestedSchema, options)
  }
  return copy
}

/**
 * Apply feed defaults to a root item and nested expanded seed clones.
 * Image relation clones get media-only link defaults (no EAS explorer URLs).
 *
 * Returns a copy and leaves `item` untouched: `item` may be a record held by the
 * `@seedprotocol/query` collection cache. Only the objects the defaults write to
 * (the root, expanded seed clones, and arrays holding them) are shallow-copied;
 * other values, notably hydrated HTML strings, are shared rather than cloned.
 */
function applyFeedDefaultsDeep(
  item: Record<string, unknown>,
  schemaName: string,
  options: SetFeedItemDefaultsOptions,
): Record<string, unknown> {
  const out = { ...item }
  const seedUid = (out.seedUid || out.SeedUid || '') as string
  setFeedItemDefaults(out, seedUid, schemaName, options)

  for (const key of Object.keys(out)) {
    if (key.startsWith('_')) continue
    const value = out[key]
    if (Array.isArray(value)) {
      if (value.some(looksLikeSeedClone)) {
        out[key] = value.map((el) =>
          looksLikeSeedClone(el) ? withNestedCloneDefaults(el, schemaName, options) : el,
        )
      }
    } else if (looksLikeSeedClone(value)) {
      out[key] = withNestedCloneDefaults(value, schemaName, options)
    }
  }
  return out
}

function seedRecordsToFeedItems(
  schemaName: string,
  records: SeedRecord[],
): Record<string, unknown>[] {
  const feedConfig = loadFeedConfig()
  const defaultsOptions: SetFeedItemDefaultsOptions = {
    itemUrlBase: feedConfig.itemUrlBase,
    itemUrlPath: feedConfig.itemUrlPath,
  }

  const publicBaseUrl = getPublicArweaveBaseUrl()
  return records.map(
    (record) =>
      withPublicArweaveLinks(applyFeedDefaultsDeep(record.data, schemaName, defaultsOptions), publicBaseUrl) as Record<
        string,
        unknown
      >,
  )
}

/**
 * `value` with every Arweave link on the public gateway: a field that is a link, and the links in
 * Html fields (ADR 0025). Query gives this reader's URLs (hydrated bodies and image URLs on its
 * first read gateway, which on a Hyper feed server is the local sidecar); RSS readers are outside
 * Seed and need public ones. Returns new arrays and objects; query's records stay as they are.
 */
function withPublicArweaveLinks(value: unknown, publicBaseUrl: string): unknown {
  if (typeof value === 'string') {
    if (value.includes('<')) return publishedArweaveLinksInHtml(value, { publicBaseUrl })
    const link = parseArweaveTransactionLink(value)
    return link ? buildArweaveTransactionLink(link, publicBaseUrl) : value
  }
  if (Array.isArray(value)) return value.map((v) => withPublicArweaveLinks(v, publicBaseUrl))
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, withPublicArweaveLinks(v, publicBaseUrl)]),
    )
  }
  return value
}

/**
 * Feed items for a page of the schema, with query's collection ETag when the collection cache
 * answered (skip 0, cache enabled): it changes whenever a listed seed or what it was built from
 * changes, so the feed can tell whether a cached body is still current.
 */
export const fetchFeedItemsBySchemaName = async (
  schemaName: string,
  options?: { limit?: number; skip?: number },
): Promise<{ items: Record<string, unknown>[]; etag?: string }> => {
  await initializeFeedPlatform()
  const limit = options?.limit ?? 100
  const skip = options?.skip ?? 0

  // Expanded relations give items their author names and image enclosures.
  const { items, etag } = await queryBySchema(schemaName, {
    limit,
    skip,
    relations: 'expand',
    hydrateStorage: true,
  })
  return { items: seedRecordsToFeedItems(schemaName, items), etag }
}

export const getFeedItemsBySchemaName = async (
  schemaName: string,
  options?: { limit?: number; skip?: number },
): Promise<Record<string, unknown>[]> =>
  (await fetchFeedItemsBySchemaName(schemaName, options)).items

export const getFeedItemsBySchemaNameForMonth = async (
  schemaName: string,
  year: number,
  month: number,
): Promise<Record<string, unknown>[]> => {
  await initializeFeedPlatform()

  const records = await queryBySchemaForMonth(schemaName, year, month, {
    relations: 'expand',
    hydrateStorage: true,
  })
  return seedRecordsToFeedItems(schemaName, records)
}
