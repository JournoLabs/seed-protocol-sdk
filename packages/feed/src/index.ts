import { client as seedClient, DEFAULT_ARWEAVE_HOST } from '@seedprotocol/sdk';
import { getArweaveUrlForTransaction } from './utils/arweaveUrl';
import { getFeedItemsBySchemaName, getFeedItemsBySchemaNameForMonth } from './getFeedItems';

export { getFeedItemsBySchemaName, getFeedItemsBySchemaNameForMonth } from './getFeedItems';
export { loadFeedConfig } from './config';
export { parseRssString, type ParsedRssChannel } from './consume/parseRss';
export {
  classifyMediaRef,
  resolveMediaRef,
  normalizeFeedItemFields,
  getFeedItemStringField,
} from '@seedprotocol/sdk';
export type {
  FeedFieldManifest,
  FeedFieldDescriptor,
  FeedFieldRole,
  ClassifyMediaRefOptions,
  MediaRefClassification,
  ResolveMediaRefResult,
  ResolveMediaRefOptions,
  NormalizedMediaField,
  NormalizedHtmlField,
  NormalizedTextField,
  NormalizedFeedFieldValue,
} from '@seedprotocol/sdk';
import pluralize from 'pluralize';
import type { FeedFormat, GraphQLItem, TransformOptions, FeedConfig, ImageMetadata } from './types';

export type { TransformOptions } from './types';
import { generateAtomFeed, generateJsonFeed } from 'feedsmith';
import { generateRssXml } from './rss/generateRssXml';
import { CacheManager } from './cache/CacheManager';
import { loadCacheConfig } from './cache/config';
import { loadFeedConfig } from './config';
import { checkIfNoneMatch } from './utils/etag';
import { ArweaveImageService } from './services/arweaveImageService';
import {
  pickFeedItemContent,
  pickFeedItemDescription,
  filterItemsByRichTextDataUriImagePolicy,
} from './pickFeedItemRichText';

export { enrichImageSeedCloneForFeed } from './imageRelationEnrichment';
export {
  pickFeedItemContent,
  pickFeedItemDescription,
  feedItemRichTextContainsDataUriImage,
  filterItemsByRichTextDataUriImagePolicy,
} from './pickFeedItemRichText';
export {
  FEED_RICH_BODY_STORAGE_SCHEMAS,
  isFeedRichBodyStorageSchema,
} from './feedFieldStorageModel';

/** RSS enclosure URL from a plain string (URL or tx id) or nested Image relation object. */
function getEnclosureUrlFromImageRelationField(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) return value
    try {
      return getArweaveUrlForTransaction(value)
    } catch {
      return undefined
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    const direct = o.arweaveUrl
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    const tx = (o.storageTransactionId ?? o.storage_transaction_id) as string | undefined
    if (tx && typeof tx === 'string' && tx.trim()) {
      try {
        return getArweaveUrlForTransaction(tx.trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

let client: any;
let initializationPromise: Promise<void> | null = null;

// Initialize cache manager
let cacheManager: CacheManager | null = null;

function getCacheManager(): CacheManager {
  if (!cacheManager) {
    const config = loadCacheConfig();
    cacheManager = new CacheManager(config);
  }
  return cacheManager;
}

/**
 * Reset cache manager (useful for testing)
 */
export function resetCacheManager(): void {
  cacheManager = null;
}

/**
 * Initialize the Seed Protocol client
 * This should be called as soon as the app is ready
 */
export const initializeSeedClient = async (): Promise<void> => {
  // If already initializing, wait for that to complete
  if (initializationPromise) {
    return initializationPromise;
  }

  // If already initialized, return immediately
  if (client) {
    return;
  }

  initializationPromise = (async () => {
    try {
      console.log('Initializing Seed Protocol client...');

      
      await seedClient.init({ config: {
        endpoints: {
          filePaths: 'app-files',
          files: '/app-files',
        },
        arweaveDomain: DEFAULT_ARWEAVE_HOST,
      }, addresses: [], });
      console.log('✅ Seed Protocol client initialized successfully');
      client = seedClient;
      initializationPromise = null; // Clear the promise after successful initialization
    } catch (error) {
      console.error('❌ Failed to initialize Seed Protocol client:', error);
      initializationPromise = null; // Clear the promise on error so we can retry
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Get the Seed Protocol client, initializing it if necessary
 * This function can be called from any context (Electron main process or Vite dev server)
 */
export const getClient = async (): Promise<any> => {
  // If client is already initialized, return it
  if (client) {
    return client;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    await initializationPromise;
    return client;
  }

  // Otherwise, initialize it now
  await initializeSeedClient();
  return client;
}


/**
 * Teardown the Seed Protocol client
 * This should be called when the app is quitting
 */
export const teardownSeedClient = async (): Promise<void> => {
  try {
    console.log('Tearing down Seed Protocol client...');
    
    if (typeof seedClient.stop === 'function') {
      await seedClient.stop();
      console.log('✅ Seed Protocol client stopped');
    }
    
    if (typeof seedClient.unload === 'function') {
      await seedClient.unload();
      console.log('✅ Seed Protocol client unloaded');
    }
    
    console.log('✅ Seed Protocol client teardown complete');
  } catch (error) {
    console.error('❌ Failed to teardown Seed Protocol client:', error);
    // Don't throw - we want the app to quit even if teardown fails
  }
}

// ============================================================================
// Configuration
// ============================================================================

const SITE_CONFIG: FeedConfig = {
  title: 'Seed Protocol',
  description: 'Content published via Seed Protocol',
  siteUrl: 'https://seedprotocol.io',
  feedUrl: 'https://feed.seedprotocol.io',
  language: 'en',
  copyright: `© ${new Date().getFullYear()} All rights reserved`,
  author: {
    name: 'Seed Protocol',
    email: 'info@seedprotocol.io',
    link: 'https://seedprotocol.io',
  },
}

// ============================================================================
// GraphQL Client (replace with your actual client)
// ============================================================================

// ============================================================================
// Feed Transformation
// ============================================================================

/**
 * Enriches feed items with media properties from Arweave storageTransactionId
 */
async function enrichFeedItemsWithMedia(
  items: GraphQLItem[],
  imageService: ArweaveImageService,
  cache: CacheManager
): Promise<GraphQLItem[]> {
  // Filter items that have storageTransactionId
  const itemsToProcess = items.filter(
    (item: any) => item.storageTransactionId || item.storage_transaction_id
  )

  if (itemsToProcess.length === 0) {
    return items
  }

  console.log(`Enriching ${itemsToProcess.length} items with image metadata`)

  // Process all items in parallel
  const enrichmentPromises = itemsToProcess.map(async (item: any) => {
    const transactionId = item.storageTransactionId || item.storage_transaction_id
    if (!transactionId) return item

    try {
      // Check cache first
      let imageMetadata = await cache.getImageMetadata(transactionId)

      // If not cached, detect image
      if (!imageMetadata) {
        console.log(`Detecting image for transaction ${transactionId}`)
        imageMetadata = await imageService.detectImage(transactionId)
        // Cache the result (even if it's not an image, to avoid retries)
        await cache.setImageMetadata(transactionId, imageMetadata)
      }

      // If image detected, add media properties
      if (imageMetadata.isImage) {
        // Add media properties to the item
        item._imageMetadata = imageMetadata
        item._hasImage = true
      }

      return item
    } catch (error) {
      console.warn(`Error enriching item with transaction ${transactionId}:`, error)
      return item // Return item unchanged on error
    }
  })

  // Wait for all enrichments to complete
  const enrichedItems = await Promise.all(enrichmentPromises)

  // Create a map of enriched items by their ID
  const enrichedMap = new Map<string, GraphQLItem>()
  enrichedItems.forEach(item => {
    const itemId = item.id || (item as any).seedUid || (item as any).SeedUid || ''
    if (itemId) {
      enrichedMap.set(itemId, item)
    }
  })

  // Merge enriched items back into original array
  return items.map(item => {
    const itemId = item.id || (item as any).seedUid || (item as any).SeedUid || ''
    const enriched = enrichedMap.get(itemId)
    return enriched || item
  })
}

/**
 * Transforms GraphQL items into feed items.
 * This function preserves all dynamic properties from the items.
 */
function transformToFeedItems(
  items: GraphQLItem[],
  options: TransformOptions
): any[] {
  const { schemaName, siteUrl, itemUrlBase, itemUrlPath, richTextDataUriImages = 'omit_items' } = options

  const filtered = filterItemsByRichTextDataUriImagePolicy(
    items as Record<string, unknown>[],
    richTextDataUriImages,
  ) as GraphQLItem[]

  return filtered.map((item: any) => {
    // Determine item ID - try multiple possible fields
    const itemId = item.id || item.seedUid || item.SeedUid || item.storageTransactionId || item.storage_transaction_id

    // Determine item URL - prefer link/Link, then import_url/importUrl, fallback to constructed URL
    const fallbackUrl =
      itemUrlBase != null
        ? `${itemUrlBase.replace(/\/$/, '')}/${(itemUrlPath ?? 'attestation/view').replace(/^\//, '')}/${itemId}`
        : `${siteUrl}/${pluralize(schemaName)}/${itemId}`
    const itemUrl = item.link || item.Link || item.import_url || item.importUrl || fallbackUrl
    
    // Determine publication date - try multiple sources
    let date: Date
    if (item.pubDate || item.PubDate) {
      // pubDate might be a string like "Mon, 07 Apr 2025 00:03:29 GMT"
      const pubDateStr = item.pubDate || item.PubDate
      date = new Date(pubDateStr)
    } else if (item.timeCreated) {
      // timeCreated is a Unix timestamp
      date = new Date(item.timeCreated * 1000)
    } else if (item.publishedAt || item.createdAt || item.updatedAt) {
      const dateValue = item.publishedAt || item.createdAt || item.updatedAt
      date = dateValue && typeof dateValue === 'object' && dateValue.constructor === Date
        ? dateValue as Date
        : new Date(dateValue as string | number)
    } else {
      date = new Date()
    }

    const description = pickFeedItemDescription(item)
    const content = pickFeedItemContent(item)

    // Start with all properties from the item to preserve dynamic schema
    const feedItem: any = {
      ...item, // Preserve all dynamic properties first
      // Map to standard feed fields
      id: itemId,
      title: item.title || item.Title || 'Untitled',
      link: itemUrl,
      description,
      content,
      pubDate: date,
      date: date,
      // Map guid - use full URL when available for proper permalink
      guid: item.guid || item.Guid || item.link || item.Link || itemUrl,
    }

    if (typeof feedItem.html === 'string' && feedItem.Html === undefined) {
      feedItem.Html = feedItem.html
    }
    if (typeof feedItem.Html === 'string' && feedItem.html === undefined) {
      feedItem.html = feedItem.Html
    }
    if (typeof feedItem.body === 'string' && feedItem.Body === undefined) {
      feedItem.Body = feedItem.body
    }
    if (typeof feedItem.Body === 'string' && feedItem.body === undefined) {
      feedItem.body = feedItem.Body
    }

    // Add image metadata if available from enrichment
    if (item._imageMetadata && item._hasImage) {
      const imageMeta: ImageMetadata = item._imageMetadata
      feedItem._imageMetadata = imageMeta
      feedItem._hasImage = true
    }

    // Convert any date-like string properties to Date objects
    Object.keys(feedItem).forEach((key) => {
      const value = feedItem[key]
      if (typeof value === 'string' && /date|time|published|created|updated/i.test(key) && key !== 'pubDate' && key !== 'date') {
        const dateValue = new Date(value)
        if (!isNaN(dateValue.getTime())) {
          feedItem[key] = dateValue
        }
      }
    })

    return feedItem
  })
}

// ============================================================================
// Feed Generator
// ============================================================================

export interface FeedPaginationOptions {
  page: number
  pageSize: number
  hasNext: boolean
  baseUrl: string
}

export interface FeedArchiveLink {
  rel: string
  href: string
}

export const createFeed = (
  items: GraphQLItem[],
  schemaName: string,
  format: FeedFormat,
  cacheBust?: string,
  pagination?: FeedPaginationOptions,
  archiveLinks?: FeedArchiveLink[],
  isArchive?: boolean,
  transformOverrides?: Partial<TransformOptions>,
): Promise<string> => {
  const collectionName = pluralize(schemaName)
  // Add cache busting parameter to feed URL if provided
  const feedUrlBase = `${SITE_CONFIG.siteUrl}/${collectionName}/${format}`
  const feedUrl = cacheBust ? `${feedUrlBase}?v=${cacheBust}` : feedUrlBase
  const feedTitle = `${SITE_CONFIG.title} - ${capitalize(collectionName)}`
  const now = new Date()

  const feedConfig = loadFeedConfig()

  // Build RFC 5005 links from pagination or archiveLinks
  const links: Array<{ rel: string; href: string; type?: string }> = []
  if (pagination) {
    const base = pagination.baseUrl.replace(/\?.*$/, '')
    const sep = base.includes('?') ? '&' : '?'
    if (pagination.hasNext) {
      links.push({ rel: 'next', href: `${base}${sep}page=${pagination.page + 1}` })
    }
    if (pagination.page > 1) {
      links.push({ rel: 'previous', href: `${base}${sep}page=${pagination.page - 1}` })
      links.push({ rel: 'first', href: `${base}${sep}page=1` })
    }
  }
  if (archiveLinks?.length) {
    for (const al of archiveLinks) {
      links.push({ rel: al.rel, href: al.href })
    }
  }

  // Transform items to preserve all dynamic properties
  const transformedItems = transformToFeedItems(items, {
    schemaName,
    siteUrl: SITE_CONFIG.siteUrl,
    itemUrlBase: feedConfig.itemUrlBase,
    itemUrlPath: feedConfig.itemUrlPath,
    richTextDataUriImages:
      transformOverrides?.richTextDataUriImages ?? feedConfig.richTextDataUriImages,
  })

  // Generate feed based on format using FeedSmith
  switch (format) {
    case 'atom': {
      // Atom feed requires: id, title, updated, links, entries
      const atomLinks: Array<{ href: string; rel?: string; type?: string }> = [
        { href: feedUrl, rel: 'self' },
        { href: SITE_CONFIG.siteUrl },
      ]
      for (const link of links) {
        atomLinks.push({
          href: link.href,
          rel: link.rel,
          type: link.type,
        })
      }
      const atomFeed = {
        id: feedUrl,
        title: feedTitle,
        updated: now,
        links: atomLinks,
        subtitle: SITE_CONFIG.description,
        rights: SITE_CONFIG.copyright,
        author: SITE_CONFIG.author ? {
          name: SITE_CONFIG.author.name,
          email: SITE_CONFIG.author.email,
          uri: SITE_CONFIG.author.link,
        } : undefined,
        entries: transformedItems.map((item) => {
          // Atom entries require: id, title, updated, links
          const entry: any = {
            id: item.id || item.link,
            title: item.title || 'Untitled',
            updated: item.date || item.pubDate || now,
            links: item.link ? [{ href: item.link }] : [],
            ...item, // Preserve all dynamic properties
          }
          if (item.content) entry.content = item.content
          if (item.description) entry.summary = item.description
          
          // Add image as enclosure link if available
          if (item._imageMetadata && item._hasImage) {
            const imageMeta: ImageMetadata = item._imageMetadata
            if (!entry.links) entry.links = []
            entry.links.push({
              href: imageMeta.url,
              rel: 'enclosure',
              type: imageMeta.mimeType || 'image/jpeg',
              length: imageMeta.size,
            })
            
            // Enhance content with image if not already present
            if (imageMeta.url && entry.content && !entry.content.includes(imageMeta.url)) {
              const imageHtml = `<img src="${imageMeta.url}" alt="${item.title || ''}"${imageMeta.width ? ` width="${imageMeta.width}"` : ''}${imageMeta.height ? ` height="${imageMeta.height}"` : ''} />`
              entry.content = typeof entry.content === 'string' 
                ? `${imageHtml}\n${entry.content}`
                : { type: 'html', value: `${imageHtml}\n${entry.content.value || entry.content}` }
            }
          }
          
          return entry
        }),
      }
      return Promise.resolve(generateAtomFeed(atomFeed) as string)
    }
    case 'json': {
      // JSON feed requires: title, items (with id)
      const nextUrl = pagination?.hasNext
        ? `${pagination.baseUrl.replace(/\?.*$/, '')}?page=${pagination.page + 1}`
        : undefined
      const jsonFeed = {
        title: feedTitle,
        home_page_url: SITE_CONFIG.siteUrl,
        feed_url: feedUrl,
        ...(nextUrl && { next_url: nextUrl }),
        description: SITE_CONFIG.description,
        author: SITE_CONFIG.author ? {
          name: SITE_CONFIG.author.name,
          url: SITE_CONFIG.author.link,
        } : undefined,
        items: transformedItems.map((item) => {
          // JSON items require: id
          const jsonItem: any = {
            id: item.id || item.link,
            ...item, // Preserve all dynamic properties
          }
          if (item.title) jsonItem.title = item.title
          if (item.link) jsonItem.url = item.link
          if (item.content) jsonItem.content_html = item.content
          if (item.description) jsonItem.summary = item.description
          if (item.date || item.pubDate) jsonItem.date_published = item.date || item.pubDate
          
          // Add image and attachments if available
          if (item._imageMetadata && item._hasImage) {
            const imageMeta: ImageMetadata = item._imageMetadata
            jsonItem.image = imageMeta.url
            
            // Add as attachment
            if (!jsonItem.attachments) jsonItem.attachments = []
            jsonItem.attachments.push({
              url: imageMeta.url,
              mime_type: imageMeta.mimeType || 'image/jpeg',
              size_in_bytes: imageMeta.size,
              title: item.title || 'Image',
            })
            
            // Enhance content_html with image if not already present
            if (imageMeta.url && jsonItem.content_html && !jsonItem.content_html.includes(imageMeta.url)) {
              const imageHtml = `<img src="${imageMeta.url}" alt="${item.title || ''}"${imageMeta.width ? ` width="${imageMeta.width}"` : ''}${imageMeta.height ? ` height="${imageMeta.height}"` : ''} />`
              jsonItem.content_html = `${imageHtml}\n${jsonItem.content_html}`
            }
          }
          
          return jsonItem
        }),
      }
      const jsonResult = generateJsonFeed(jsonFeed)
      return Promise.resolve(typeof jsonResult === 'string' ? jsonResult : JSON.stringify(jsonResult))
    }
    case 'rss':
    default: {
      // RSS feed requires: title, link, description, items
      const rssFeed = {
        title: feedTitle,
        link: SITE_CONFIG.siteUrl,
        description: SITE_CONFIG.description,
        links: links.length ? links.map((l) => ({ rel: l.rel, href: l.href, type: l.type })) : undefined,
        isArchive: isArchive ?? false,
        language: SITE_CONFIG.language,
        copyright: SITE_CONFIG.copyright,
        webMaster: SITE_CONFIG.author?.email,
        pubDate: now,
        lastBuildDate: now,
        items: transformedItems.map((item: any) => {
          // RSS items can have dynamic properties
          const rssItem: any = {
            ...item, // Preserve all dynamic properties
          }
          
          // Ensure required/standard RSS fields
          if (item.title) rssItem.title = item.title
          if (item.link) rssItem.link = item.link
          if (item.description) rssItem.description = item.description
          if (item.date || item.pubDate) rssItem.pubDate = item.date || item.pubDate
          
          // Map guid - RSS requires guid for proper item identification
          if (item.guid) {
            rssItem.guid = {
              value: item.guid,
              isPermaLink: typeof item.guid === 'string' && (item.guid.startsWith('http://') || item.guid.startsWith('https://'))
            }
          } else if (item.id) {
            rssItem.guid = {
              value: item.id,
              isPermaLink: typeof item.id === 'string' && (item.id.startsWith('http://') || item.id.startsWith('https://'))
            }
          }
          
          // Add image from storageTransactionId if available (from enrichment)
          if (item._imageMetadata && item._hasImage) {
            const imageMeta: ImageMetadata = item._imageMetadata
            
            // Add enclosure for RSS (standard RSS 2.0)
            rssItem.enclosures = [{
              url: imageMeta.url,
              type: imageMeta.mimeType || 'image/jpeg',
              length: imageMeta.size,
            }]
            
            // Build comprehensive Media RSS properties
            const mediaContent: any = {
              url: imageMeta.url,
              type: imageMeta.mimeType || 'image/jpeg',
              medium: 'image', // image, video, audio, document
            }
            
            // Add dimensions if available
            if (imageMeta.width) mediaContent.width = imageMeta.width
            if (imageMeta.height) mediaContent.height = imageMeta.height
            if (imageMeta.size) mediaContent.fileSize = imageMeta.size
            if (imageMeta.format) mediaContent.format = imageMeta.format
            
            // Add Media RSS namespace properties
            rssItem['media:content'] = [mediaContent]
            
            // Add media:thumbnail (required by many readers)
            const thumbnail: any = {
              url: imageMeta.url,
            }
            if (imageMeta.width) thumbnail.width = imageMeta.width
            if (imageMeta.height) thumbnail.height = imageMeta.height
            rssItem['media:thumbnail'] = [thumbnail]
            
            // Add media:title (many readers look for this)
            if (item.title) {
              rssItem['media:title'] = item.title
            }
            
            // Add media:description (enhanced)
            const mediaDescription = item.description || item.summary || item.title || ''
            if (mediaDescription) {
              rssItem['media:description'] = mediaDescription
            }
            
            // Add media:keywords for better discoverability
            if (item.title) {
              // Extract keywords from title and description
              const keywords: string[] = []
              if (item.title) {
                keywords.push(...item.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3))
              }
              if (item.description) {
                keywords.push(...item.description.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3))
              }
              if (keywords.length > 0) {
                rssItem['media:keywords'] = [...new Set(keywords)].slice(0, 10).join(', ')
              }
            }
            
            // Add media:credit (author information)
            if (item.authors && Array.isArray(item.authors) && item.authors.length > 0) {
              rssItem['media:credit'] = item.authors.map((author: any) => ({
                value: author.name || author.displayName || 'Unknown',
                role: 'author',
              }))
            } else if (SITE_CONFIG.author) {
              rssItem['media:credit'] = [{
                value: SITE_CONFIG.author.name,
                role: 'author',
              }]
            }
            
            // Add media:copyright
            if (SITE_CONFIG.copyright) {
              rssItem['media:copyright'] = SITE_CONFIG.copyright
            }
            
            // Add media:category (can be used for content categorization)
            if (schemaName) {
              rssItem['media:category'] = [{
                value: schemaName,
                scheme: 'http://www.schema.org/',
              }]
            }
            
            // Add media:group to bundle all media elements together
            // This is useful for readers that prefer grouped media
            rssItem['media:group'] = [{
              'media:content': [mediaContent],
              'media:thumbnail': [thumbnail],
              'media:title': item.title || 'Untitled',
              'media:description': mediaDescription,
            }]
            
            // Enhance content:encoded with image if not already present
            if (imageMeta.url && item.content && !item.content.includes(imageMeta.url)) {
              const imageHtml = `<img src="${imageMeta.url}" alt="${item.title || ''}"${imageMeta.width ? ` width="${imageMeta.width}"` : ''}${imageMeta.height ? ` height="${imageMeta.height}"` : ''} />`
              rssItem['content:encoded'] = `${imageHtml}\n${item.content}`
            }
          }

          if (
            typeof item.content === 'string' &&
            item.content.trim() !== '' &&
            rssItem['content:encoded'] === undefined
          ) {
            rssItem['content:encoded'] = item.content
          }
          
          // Map feature_image / image to enclosure for RSS (media attachments) - fallback
          if (!rssItem.enclosures && (item.feature_image || item.featureImage || item.image)) {
            const imageField = item.feature_image || item.featureImage || item.image
            const enclosureUrl = getEnclosureUrlFromImageRelationField(imageField)
            if (enclosureUrl) {
              rssItem.enclosures = [{
                url: enclosureUrl,
                type: 'image/jpeg',
              }]
            }
          }
          
          // Use Dublin Core namespace for additional metadata
          rssItem.dc = {}
          
          // Add date using dc namespace (supports multiple dates)
          if (item.date || item.pubDate) {
            rssItem.dc.date = item.date || item.pubDate
          }
          if (item.timeCreated) {
            // Convert Unix timestamp to Date for dc namespace
            const timeCreatedDate = new Date(item.timeCreated * 1000)
            if (!rssItem.dc.dates) rssItem.dc.dates = []
            rssItem.dc.dates.push(timeCreatedDate)
          }
          
          // Add identifier using dc namespace
          if (item.seedUid || item.SeedUid) {
            if (!rssItem.dc.identifier) rssItem.dc.identifier = []
            rssItem.dc.identifier.push(item.seedUid || item.SeedUid)
          }
          if (item.storageTransactionId || item.storage_transaction_id) {
            if (!rssItem.dc.identifier) rssItem.dc.identifier = []
            rssItem.dc.identifier.push(item.storageTransactionId || item.storage_transaction_id)
          }
          
          // Add source/relation for import_url
          if (item.import_url || item.importUrl) {
            rssItem.dc.source = item.import_url || item.importUrl
          }
          
          // Include raw custom fields as well (FeedSmith may preserve them)
          if (item.seedUid || item.SeedUid) rssItem.seedUid = item.seedUid || item.SeedUid
          if (item.storageTransactionId || item.storage_transaction_id) {
            rssItem.storageTransactionId = item.storageTransactionId || item.storage_transaction_id
          }
          if (item.timeCreated) rssItem.timeCreated = item.timeCreated
          
          return rssItem
        }),
      }
      return Promise.resolve(generateRssXml(rssFeed))
    }
  }
}

// ============================================================================
// Route Handler
// ============================================================================

function getContentType(format: FeedFormat): string {
  switch (format) {
    case 'atom':
      return 'application/atom+xml; charset=utf-8'
    case 'json':
      return 'application/feed+json; charset=utf-8'
    case 'rss':
    default:
      return 'application/rss+xml; charset=utf-8'
  }
}

function parseFormat(segment: string): FeedFormat | null {
  const normalized = segment.toLowerCase()
  if (['rss', 'atom', 'json'].includes(normalized)) {
    return normalized as FeedFormat
  }
  return null
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Main route handler for feed generation.
 * 
 * URL Pattern: /:collection/:format
 * Examples:
 *   - /posts/rss    → RSS feed of posts
 *   - /posts/atom   → Atom feed of posts
 *   - /identities/json → JSON feed of identities
 *   - /posts/rss?v=1234567890 → RSS feed with cache busting parameter
 */
export async function handleFeedRequest(
  collectionSegment: string,
  formatSegment: string,
  ifNoneMatch?: string | null,
  cacheBust?: string,
  page?: number
): Promise<Response> {
  // Validate format
  const format = parseFormat(formatSegment)
  if (!format) {
    return new Response(
      JSON.stringify({ error: `Invalid feed format: ${formatSegment}` }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // De-pluralize the collection name to get model type
  const schemaName = pluralize.singular(collectionSegment.toLowerCase())
  const collectionName = pluralize(schemaName)

  const feedConfig = loadFeedConfig()
  const pageNum = Math.max(1, page ?? 1)
  const pageSize = feedConfig.pageSize
  const skip = (pageNum - 1) * pageSize

  const contentKeyOptions =
    pageNum > 1 ? { page: pageNum } : undefined

  console.log(`Schema name: ${schemaName}`);
  console.log(`Collection name: ${collectionName}`);

  const cache = getCacheManager();
  const config = loadCacheConfig();

  try {
    // Check if we have cached feed content
    if (config.enabled) {
      const cachedContent = await cache.getFeedContent(schemaName, format, contentKeyOptions);
      
      if (cachedContent) {
        // Check ETag for conditional request
        if (ifNoneMatch && checkIfNoneMatch(ifNoneMatch, cachedContent.etag)) {
          console.log(`Cache hit with ETag match for ${schemaName}:${format} - returning 304`);
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': cachedContent.etag,
              'Last-Modified': new Date(cachedContent.lastModified * 1000).toUTCString(),
              'Cache-Control': 'public, max-age=3600, s-maxage=3600, must-revalidate',
            },
          });
        }

        // Return cached content
        console.log(`Cache hit for ${schemaName}:${format}`);
        return new Response(cachedContent.content, {
          status: 200,
          headers: {
            'Content-Type': cachedContent.contentType,
            'ETag': cachedContent.etag,
            'Last-Modified': new Date(cachedContent.lastModified * 1000).toUTCString(),
            'Cache-Control': 'public, max-age=3600, s-maxage=3600, must-revalidate',
            'X-Feed-Schema': schemaName,
            'X-Feed-Format': format,
            'X-Cache': 'HIT',
          },
        });
      }
    }

    // Cache miss or disabled - fetch and process items
    console.log(`Cache miss for ${schemaName}:${format} - fetching items`);

    const fetchItems = async (): Promise<GraphQLItem[]> => {
      const items = await getFeedItemsBySchemaName(schemaName, { limit: pageSize, skip }) as GraphQLItem[];
      if (config.imageMetadata?.enabled) {
        const imageService = new ArweaveImageService({
          gateways: config.imageMetadata.gateways,
          timeout: config.imageMetadata.timeout,
        });
        return enrichFeedItemsWithMedia(items, imageService, cache);
      }
      return items;
    };

    const feedItems = config.enabled && pageNum === 1
      ? await cache.withRefreshLock(schemaName, async () => {
          const cachedData = await cache.getFeedData(schemaName);
          let items: GraphQLItem[];

          if (cachedData) {
            console.log(`Incremental fetch: last processed timestamp: ${cachedData.lastProcessedTimestamp}`);
            const allItems = await getFeedItemsBySchemaName(schemaName, { limit: pageSize, skip: 0 }) as GraphQLItem[];
            const newItems = cache.filterNewItems(allItems, cachedData.lastProcessedTimestamp);

            if (newItems.length > 0) {
              console.log(`Found ${newItems.length} new items, merging with ${cachedData.items.length} cached items`);
              items = cache.mergeItems(cachedData.items, newItems).slice(0, pageSize);
            } else {
              items = cachedData.items;
            }
          } else {
            console.log(`Cold cache - fetching page 1`);
            const client = await getClient();
            if (client) console.log(`Client initialized: ${client.isInitialized()}`);
            items = await getFeedItemsBySchemaName(schemaName, { limit: pageSize, skip: 0 }) as GraphQLItem[];
            console.log(`Found ${items.length} feed items for schema ${schemaName}`);
          }

          if (config.imageMetadata?.enabled) {
            const imageService = new ArweaveImageService({
              gateways: config.imageMetadata.gateways,
              timeout: config.imageMetadata.timeout,
            });
            const enrichedItems = await enrichFeedItemsWithMedia(items, imageService, cache);
            await cache.setFeedData(schemaName, items);
            return enrichedItems;
          }
          await cache.setFeedData(schemaName, items);
          return items;
        })
      : await fetchItems();

    const baseUrl = `${SITE_CONFIG.feedUrl}/${collectionName}/${format}`;
    const hasNext = feedItems.length === pageSize;
    const archiveLinksForMain: FeedArchiveLink[] = [];
    if (pageNum === 1) {
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      archiveLinksForMain.push({
        rel: 'prev-archive',
        href: `${SITE_CONFIG.feedUrl}/${collectionName}/archive/${prevMonth.getFullYear()}/${prevMonth.getMonth() + 1}/${format}`,
      });
    }

    const paginationOptions: FeedPaginationOptions | undefined = {
      page: pageNum,
      pageSize,
      hasNext,
      baseUrl,
    };

    const feedContent = await createFeed(
      feedItems,
      schemaName,
      format,
      cacheBust,
      paginationOptions,
      archiveLinksForMain.length ? archiveLinksForMain : undefined,
      false
    );
    const contentType = getContentType(format);

    // Cache the generated feed content
    if (config.enabled) {
      await cache.setFeedContent(schemaName, format, feedContent, contentType, contentKeyOptions);
      
      // Get the cached content to retrieve ETag
      const cachedContent = await cache.getFeedContent(schemaName, format, contentKeyOptions);
      const etag = cachedContent?.etag || '';
      const lastModified = cachedContent?.lastModified || Math.floor(Date.now() / 1000);

      return new Response(feedContent, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'ETag': etag,
          'Last-Modified': new Date(lastModified * 1000).toUTCString(),
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, must-revalidate',
          'X-Feed-Schema': schemaName,
          'X-Feed-Format': format,
          'X-Cache': 'MISS',
        },
      });
    }

    // Cache disabled - return without caching
    return new Response(feedContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'X-Feed-Schema': schemaName,
        'X-Feed-Format': format,
      },
    });
  } catch (error) {
    console.error('Feed generation error:', error);
    
    // Try to serve stale cache on error if available
    if (config.enabled) {
      const staleContent = await cache.getFeedContent(schemaName, format, contentKeyOptions);
      if (staleContent) {
        console.log(`Serving stale cache due to error`);
        return new Response(staleContent.content, {
          status: 200,
          headers: {
            'Content-Type': staleContent.contentType,
            'ETag': staleContent.etag,
            'Cache-Control': 'public, max-age=3600, s-maxage=3600, must-revalidate',
            'X-Feed-Schema': schemaName,
            'X-Feed-Format': format,
            'X-Cache': 'STALE',
            'Warning': '299 - "Cache is stale"',
          },
        });
      }
    }
    
    return new Response(
      JSON.stringify({
        error: 'Failed to generate feed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * Route handler for monthly archive feeds (RFC 5005).
 *
 * URL Pattern: /:collection/archive/:year/:month/:format
 * Examples:
 *   - /posts/archive/2024/02/rss → RSS feed of posts from February 2024
 */
export async function handleArchiveFeedRequest(
  collectionSegment: string,
  year: number,
  month: number,
  formatSegment: string,
  ifNoneMatch?: string | null,
  cacheBust?: string
): Promise<Response> {
  if (year < 1970 || year > 2100) {
    return new Response(
      JSON.stringify({ error: `Invalid year: ${year}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (month < 1 || month > 12) {
    return new Response(
      JSON.stringify({ error: `Invalid month: ${month}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const format = parseFormat(formatSegment);
  if (!format) {
    return new Response(
      JSON.stringify({ error: `Invalid feed format: ${formatSegment}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const schemaName = pluralize.singular(collectionSegment.toLowerCase());
  const collectionName = pluralize(schemaName);

  const contentKeyOptions = { archive: { year, month } };
  const cache = getCacheManager();
  const config = loadCacheConfig();

  try {
    if (config.enabled) {
      const cachedContent = await cache.getFeedContent(schemaName, format, contentKeyOptions);
      if (cachedContent) {
        if (ifNoneMatch && checkIfNoneMatch(ifNoneMatch, cachedContent.etag)) {
          return new Response(null, {
            status: 304,
            headers: {
              ETag: cachedContent.etag,
              'Last-Modified': new Date(cachedContent.lastModified * 1000).toUTCString(),
              'Cache-Control': 'public, max-age=86400, s-maxage=86400, must-revalidate',
            },
          });
        }
        return new Response(cachedContent.content, {
          status: 200,
          headers: {
            'Content-Type': cachedContent.contentType,
            ETag: cachedContent.etag,
            'Last-Modified': new Date(cachedContent.lastModified * 1000).toUTCString(),
            'Cache-Control': 'public, max-age=86400, s-maxage=86400, must-revalidate',
            'X-Feed-Schema': schemaName,
            'X-Feed-Format': format,
            'X-Cache': 'HIT',
          },
        });
      }
    }

    const items = await getFeedItemsBySchemaNameForMonth(schemaName, year, month) as GraphQLItem[];

    const baseUrl = `${SITE_CONFIG.feedUrl}/${collectionName}/${format}`;
    const archiveBase = `${SITE_CONFIG.feedUrl}/${collectionName}/archive`;

    const archiveLinks: FeedArchiveLink[] = [
      { rel: 'prev-archive', href: `${archiveBase}/${month === 1 ? year - 1 : year}/${month === 1 ? 12 : month - 1}/${format}` },
      { rel: 'current', href: baseUrl },
    ];

    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const now = new Date();
    if (nextYear < now.getFullYear() || (nextYear === now.getFullYear() && nextMonth <= now.getMonth() + 1)) {
      archiveLinks.push({ rel: 'next-archive', href: `${archiveBase}/${nextYear}/${nextMonth}/${format}` });
    }

    const feedContent = await createFeed(
      items,
      schemaName,
      format,
      cacheBust,
      undefined,
      archiveLinks,
      true
    );

    const contentType = getContentType(format);

    if (config.enabled) {
      await cache.setFeedContent(schemaName, format, feedContent, contentType, contentKeyOptions);
      const cachedContent = await cache.getFeedContent(schemaName, format, contentKeyOptions);
      const etag = cachedContent?.etag || '';
      const lastModified = cachedContent?.lastModified || Math.floor(Date.now() / 1000);

      return new Response(feedContent, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          ETag: etag,
          'Last-Modified': new Date(lastModified * 1000).toUTCString(),
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, must-revalidate',
          'X-Feed-Schema': schemaName,
          'X-Feed-Format': format,
          'X-Cache': 'MISS',
        },
      });
    }

    return new Response(feedContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-Feed-Schema': schemaName,
        'X-Feed-Format': format,
      },
    });
  } catch (error) {
    console.error('Archive feed generation error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to generate archive feed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}