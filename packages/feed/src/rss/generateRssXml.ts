import { create } from 'xmlbuilder2'
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces'

const DC_NS = 'http://purl.org/dc/elements/1.1/'
const CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/'
const MEDIA_NS = 'http://search.yahoo.com/mrss/'
type RelationNamespaceContext = { prefix: string; uri: string }
type RelationNamespaceMap = Record<string, RelationNamespaceContext>
const RELATION_NAMESPACES: RelationNamespaceMap = {
  publication: {
    prefix: 'publication',
    uri: 'https://seedprotocol.io/ns/publication/1.0',
  },
}
const RELATION_NAMESPACE_URI_BASE = 'https://seedprotocol.io/ns/relations'
const RESERVED_XML_PREFIXES = new Set(['xml', 'xmlns', 'dc', 'media', 'content', 'atom', 'fh'])

const CAPITALIZED_DUPLICATES = new Set(['Title', 'Link', 'Guid', 'PubDate', 'SeedUid'])

function isRedundantCapitalizedKey(key: string, item: Record<string, unknown>): boolean {
  if (!CAPITALIZED_DUPLICATES.has(key)) return false
  const lowerKey = key.charAt(0).toLowerCase() + key.slice(1)
  return lowerKey in item
}

const RSS_ITEM_ORDER = [
  'title',
  'link',
  'description',
  'guid',
  'pubDate',
  'author',
  'authors',
  'categories',
  'comments',
  'enclosures',
  'source',
  'dc',
  'content:encoded',
  'media:content',
  'media:thumbnail',
  'media:title',
  'media:description',
  'media:keywords',
  'media:credit',
  'media:copyright',
  'media:category',
  'media:group',
]

function formatRfc822Date(date: Date | string): string {
  if (date instanceof Date) {
    return date.toUTCString()
  }
  if (typeof date === 'string') {
    const d = new Date(date)
    return !Number.isNaN(d.getTime()) ? d.toUTCString() : date
  }
  return String(date)
}

function needsCdata(value: string): boolean {
  return /[<>&]|]]>/.test(value)
}

function addTextOrCdata(parent: XMLBuilder, value: string): void {
  const str = String(value)
  if (str === '') return

  if (needsCdata(str)) {
    if (str.includes(']]>')) {
      const parts = str.split(']]>')
      for (let i = 0; i < parts.length; i++) {
        parent.dat(parts[i]!)
        if (i < parts.length - 1) {
          parent.txt(']]>')
        }
      }
    } else {
      parent.dat(str)
    }
  } else {
    parent.txt(str)
  }
}

function isExpandedRelationObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

const MAX_EXPANDED_RELATION_DEPTH = 4
const NON_RELATION_KEYS = new Set([
  ...RSS_ITEM_ORDER,
  'guid',
  'source',
  'dc',
  'content',
  'content:encoded',
  'items',
])

function normalizeRelationKey(key: string): string {
  return key.endsWith('s') && key.length > 1 ? key.slice(0, -1) : key
}

function sanitizePrefixToken(rawKey: string): string {
  const token = rawKey
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .replace(/^$/, 'rel')
  return token.toLowerCase()
}

function createUniquePrefix(
  preferredPrefix: string,
  usedPrefixes: Set<string>
): string {
  if (!usedPrefixes.has(preferredPrefix) && !RESERVED_XML_PREFIXES.has(preferredPrefix)) {
    usedPrefixes.add(preferredPrefix)
    return preferredPrefix
  }

  let suffix = 2
  while (true) {
    const candidate = `${preferredPrefix}${suffix}`
    if (!usedPrefixes.has(candidate) && !RESERVED_XML_PREFIXES.has(candidate)) {
      usedPrefixes.add(candidate)
      return candidate
    }
    suffix += 1
  }
}

function isRelationArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isExpandedRelationObject(entry))
  )
}

function buildRelationNamespaceMap(items: Record<string, unknown>[]): RelationNamespaceMap {
  const relationNamespaces: RelationNamespaceMap = { ...RELATION_NAMESPACES }
  const usedPrefixes = new Set(
    Object.values(relationNamespaces).map((namespaceContext) => namespaceContext.prefix)
  )

  const discoveredRelationKeys = new Set<string>()
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      const isAuthorRelation =
        (key === 'author' && isExpandedRelationObject(value)) ||
        (key === 'authors' && isRelationArray(value))
      if (key.startsWith('_')) continue
      if (NON_RELATION_KEYS.has(key) && !isAuthorRelation) continue
      if (isExpandedRelationObject(value) || isRelationArray(value)) {
        discoveredRelationKeys.add(normalizeRelationKey(key))
      }
    }
  }

  const sortedDiscoveredRelationKeys = [...discoveredRelationKeys].sort()
  for (const relationKey of sortedDiscoveredRelationKeys) {
    if (relationNamespaces[relationKey]) continue
    const preferredPrefix = sanitizePrefixToken(relationKey)
    const prefix = createUniquePrefix(preferredPrefix, usedPrefixes)
    relationNamespaces[relationKey] = {
      prefix,
      uri: `${RELATION_NAMESPACE_URI_BASE}/${relationKey}/1.0`,
    }
  }

  return relationNamespaces
}

function getRelationNamespaceContext(
  key: string,
  relationNamespaces: RelationNamespaceMap
): RelationNamespaceContext | undefined {
  if (key in relationNamespaces) return relationNamespaces[key]
  if (key.endsWith('s') && key.length > 1) {
    const singular = key.slice(0, -1)
    if (singular in relationNamespaces) return relationNamespaces[singular]
  }
  return undefined
}

function getNamespacedChildTagName(localName: string, namespaceContext?: RelationNamespaceContext): string {
  if (!namespaceContext) return localName
  return `${namespaceContext.prefix}:${localName}`
}

function serializeExpandedRelation(
  parent: XMLBuilder,
  obj: Record<string, unknown>,
  tagName: string,
  addDcCreator?: boolean,
  depth = 0,
  namespaceContext?: RelationNamespaceContext
): void {
  const ele = parent.ele(tagName)
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || k.startsWith('_') || k === 'items') continue
    const childTagName = getNamespacedChildTagName(k, namespaceContext)
    if (depth >= MAX_EXPANDED_RELATION_DEPTH) {
      const child = ele.ele(childTagName)
      addTextOrCdata(child, typeof v === 'object' ? JSON.stringify(v) : String(v))
      continue
    }
    if (Array.isArray(v)) {
      const itemTag = k.endsWith('s') && k.length > 1 ? k.slice(0, -1) : k
      const childItemTag = getNamespacedChildTagName(itemTag, namespaceContext)
      for (const entry of v) {
        if (entry === undefined || entry === null) continue
        if (isExpandedRelationObject(entry)) {
          serializeExpandedRelation(ele, entry, childItemTag, false, depth + 1, namespaceContext)
        } else {
          const leaf = ele.ele(childItemTag)
          addTextOrCdata(leaf, String(entry))
        }
      }
      continue
    }
    if (isExpandedRelationObject(v)) {
      serializeExpandedRelation(
        ele,
        v as Record<string, unknown>,
        childTagName,
        false,
        depth + 1,
        namespaceContext
      )
      continue
    }
    const child = ele.ele(childTagName)
    addTextOrCdata(child, String(v))
  }
  if (addDcCreator) {
    const name = obj.name ?? obj.seedUid
    if (name) parent.ele(DC_NS, 'creator').txt(String(name))
  }
}

function serializeItemProperty(
  itemParent: XMLBuilder,
  key: string,
  value: unknown,
  item: Record<string, unknown>,
  relationNamespaces: RelationNamespaceMap
): void {
  if (value === undefined || value === null || key.startsWith('_')) return
  if (key === 'items') return

  if (key === 'guid') {
    const guid = value as { value?: string; isPermaLink?: boolean }
    const val = guid?.value ?? String(value)
    if (!val) return
    const attrs: Record<string, string> = {}
    if (typeof guid?.isPermaLink === 'boolean') {
      attrs.isPermaLink = guid.isPermaLink ? 'true' : 'false'
    }
    const guidEle = itemParent.ele('guid', attrs)
    addTextOrCdata(guidEle, val)
    return
  }

  if (key === 'source' && value !== null && typeof value === 'object') {
    const src = value as { title?: string; url?: string }
    const title = src.title ?? String(value)
    if (!title) return
    const attrs = src.url ? { url: src.url } : {}
    itemParent.ele('source', attrs).txt(title)
    return
  }

  if (key === 'enclosures' && Array.isArray(value)) {
    for (const enc of value) {
      if (enc && typeof enc === 'object' && 'url' in enc) {
        const attrs: Record<string, string> = {
          url: String(enc.url),
          type: String(enc.type ?? 'application/octet-stream'),
        }
        if (enc.length != null) attrs.length = String(enc.length)
        itemParent.ele('enclosure', attrs)
      }
    }
    return
  }

  if (key === 'dc' && value !== null && typeof value === 'object') {
    const dc = value as Record<string, unknown>
    for (const [dcKey, dcVal] of Object.entries(dc)) {
      if (dcVal === undefined || dcVal === null) continue
      if (Array.isArray(dcVal)) {
        for (const v of dcVal) {
          if (v !== undefined && v !== null) {
            const ele = itemParent.ele(DC_NS, dcKey)
            if (v instanceof Date) {
              ele.txt(v.toISOString())
            } else {
              addTextOrCdata(ele, String(v))
            }
          }
        }
      } else {
        const ele = itemParent.ele(DC_NS, dcKey)
        if (dcVal instanceof Date) {
          ele.txt(dcVal.toISOString())
        } else {
          addTextOrCdata(ele, String(dcVal))
        }
      }
    }
    return
  }

  if (key === 'content:encoded') {
    const ele = itemParent.ele(CONTENT_NS, 'encoded')
    addTextOrCdata(ele, String(value))
    return
  }
  if (key === 'content' && typeof value === 'string' && !('content:encoded' in item)) {
    const ele = itemParent.ele(CONTENT_NS, 'encoded')
    addTextOrCdata(ele, String(value))
    return
  }
  if (key === 'content') return

  if (key === 'media:group' && Array.isArray(value)) {
    for (const group of value) {
      if (group && typeof group === 'object') {
        const groupEle = itemParent.ele(MEDIA_NS, 'group')
        for (const [gk, gv] of Object.entries(group)) {
          if (gv === undefined || gv === null) continue
          if (gk.startsWith('media:')) {
            const ln = gk.slice(6)
            if (Array.isArray(gv)) {
              for (const v of gv) {
                if (v && typeof v === 'object') {
                  const child = groupEle.ele(MEDIA_NS, ln)
                  for (const [ck, cv] of Object.entries(v)) {
                    if (cv !== undefined && cv !== null) {
                      if (ck === 'url' || ck === 'value') {
                        addTextOrCdata(child, String(cv))
                      } else {
                        child.att(ck, String(cv))
                      }
                    }
                  }
                }
              }
            } else if (typeof gv === 'string') {
              addTextOrCdata(groupEle.ele(MEDIA_NS, ln), gv)
            }
          }
        }
      }
    }
    return
  }

  if (key.startsWith('media:') && Array.isArray(value)) {
    const localName = key.slice(6)
    for (const item of value) {
      if (item === null || typeof item !== 'object') continue
      const attrs: Record<string, string> = {}
      let textContent: string | null = null
      for (const [attr, attrVal] of Object.entries(item)) {
        if (attrVal === undefined || attrVal === null) continue
        if (attr === 'value') {
          textContent = String(attrVal)
        } else {
          attrs[attr] = String(attrVal)
        }
      }
      const mediaEle = itemParent.ele(MEDIA_NS, localName, attrs)
      if (textContent !== null) {
        addTextOrCdata(mediaEle, textContent)
      }
    }
    return
  }

  if (key.startsWith('media:') && typeof value === 'string') {
    const localName = key.slice(6)
    const ele = itemParent.ele(MEDIA_NS, localName)
    addTextOrCdata(ele, value)
    return
  }

  if (value instanceof Date) {
    const ele = itemParent.ele(key)
    ele.txt(formatRfc822Date(value))
    return
  }

  if (key === 'author' && isExpandedRelationObject(value)) {
    const namespaceContext = getRelationNamespaceContext(key, relationNamespaces)
    serializeExpandedRelation(itemParent, value, 'author', true, 0, namespaceContext)
    return
  }

  if (key === 'authors' && Array.isArray(value)) {
    const namespaceContext = getRelationNamespaceContext(key, relationNamespaces)
    for (const a of value) {
      if (a && isExpandedRelationObject(a)) {
        serializeExpandedRelation(itemParent, a, 'author', true, 0, namespaceContext)
      } else {
        const authorStr =
          typeof a === 'string'
            ? a
            : a && typeof a === 'object' && 'name' in a
              ? `${(a as { email?: string }).email ?? ''} (${(a as { name?: string }).name ?? ''})`.trim() ||
                (a as { name?: string }).name
              : String(a)
        if (authorStr) itemParent.ele('author').txt(authorStr)
      }
    }
    return
  }
  if (key === 'categories' && Array.isArray(value)) {
    for (const c of value) {
      const cat =
        c && typeof c === 'object' && 'name' in c ? (c as { name: string }).name : String(c)
      if (cat) {
        const attrs =
          c && typeof c === 'object' && 'domain' in c && (c as { domain?: string }).domain
            ? { domain: (c as { domain: string }).domain }
            : {}
        itemParent.ele('category', attrs).txt(cat)
      }
    }
    return
  }

  // Array of expanded relation objects (e.g. coAuthors as list)
  if (Array.isArray(value) && value.length > 0 && value.every((v) => isExpandedRelationObject(v))) {
    const tagName = key.endsWith('s') ? key.slice(0, -1) : key
    const namespaceContext = getRelationNamespaceContext(key, relationNamespaces)
    for (const v of value) {
      if (v) serializeExpandedRelation(itemParent, v, tagName, false, 0, namespaceContext)
    }
    return
  }

  // Array of strings (e.g. resolved relation URLs for list relations like images)
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    const tagName = key.endsWith('s') ? key.slice(0, -1) : key
    for (const v of value) {
      if (v) {
        const ele = itemParent.ele(tagName)
        addTextOrCdata(ele, v)
      }
    }
    return
  }

  // Generic expanded relation object (e.g. coAuthor, other relation properties)
  if (isExpandedRelationObject(value)) {
    const namespaceContext = getRelationNamespaceContext(key, relationNamespaces)
    serializeExpandedRelation(itemParent, value, key, false, 0, namespaceContext)
    return
  }

  const ele = itemParent.ele(key)
  addTextOrCdata(ele, String(value))
}

const ATOM_NS = 'http://www.w3.org/2005/Atom'
const FH_NS = 'http://purl.org/syndication/history/1.0'

export interface RssFeedLink {
  rel: string
  href: string
  type?: string
}

export interface RssFeedInput {
  title: string
  link?: string
  description: string
  language?: string
  copyright?: string
  webMaster?: string
  pubDate?: Date
  lastBuildDate?: Date
  items: Record<string, unknown>[]
  /** RFC 5005 pagination/archive links (atom:link in channel) */
  links?: RssFeedLink[]
  /** RFC 5005 archive document marker */
  isArchive?: boolean
}

export function generateRssXml(rssFeed: RssFeedInput): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
  const relationNamespaces = buildRelationNamespaceMap(rssFeed.items)
  const relationNamespaceAttrs = Object.values(relationNamespaces).reduce<Record<string, string>>(
    (acc, relationNamespace) => {
      acc[`xmlns:${relationNamespace.prefix}`] = relationNamespace.uri
      return acc
    },
    {}
  )
  const rssAttrs: Record<string, string> = {
    'xmlns:dc': DC_NS,
    'xmlns:content': CONTENT_NS,
    'xmlns:media': MEDIA_NS,
    'xmlns:atom': ATOM_NS,
    ...relationNamespaceAttrs,
  }
  if (rssFeed.isArchive) {
    rssAttrs['xmlns:fh'] = FH_NS
  }
  const rss = doc.ele('rss', { version: '2.0', ...rssAttrs })
  const channel = rss.ele('channel', {
    'xmlns:dc': DC_NS,
    'xmlns:content': CONTENT_NS,
    'xmlns:media': MEDIA_NS,
  })

  channel.ele('title').txt(rssFeed.title)
  if (rssFeed.link) channel.ele('link').txt(rssFeed.link)
  channel.ele('description').txt(rssFeed.description)
  if (rssFeed.language) channel.ele('language').txt(rssFeed.language)
  if (rssFeed.copyright) channel.ele('copyright').txt(rssFeed.copyright)
  if (rssFeed.webMaster) channel.ele('webMaster').txt(rssFeed.webMaster)
  if (rssFeed.pubDate) channel.ele('pubDate').txt(formatRfc822Date(rssFeed.pubDate))
  if (rssFeed.lastBuildDate) channel.ele('lastBuildDate').txt(formatRfc822Date(rssFeed.lastBuildDate))

  if (rssFeed.links?.length) {
    for (const link of rssFeed.links) {
      const attrs: Record<string, string> = { rel: link.rel, href: link.href }
      if (link.type) attrs.type = link.type
      channel.ele(ATOM_NS, 'link', attrs)
    }
  }
  if (rssFeed.isArchive) {
    channel.ele(FH_NS, 'archive')
  }

  const orderedSet = new Set(RSS_ITEM_ORDER)

  for (const item of rssFeed.items) {
    const itemParent = channel.ele('item')
    const processedKeys = new Set<string>()

    for (const key of RSS_ITEM_ORDER) {
      if (key in item) {
        serializeItemProperty(itemParent, key, item[key], item, relationNamespaces)
        processedKeys.add(key)
      }
    }
    const otherKeys = Object.keys(item)
      .filter(
        (k) =>
          !processedKeys.has(k) &&
          !orderedSet.has(k) &&
          !k.startsWith('_') &&
          !isRedundantCapitalizedKey(k, item)
      )
      .sort()
    for (const key of otherKeys) {
      serializeItemProperty(itemParent, key, item[key], item, relationNamespaces)
    }
  }

  return doc.end({ prettyPrint: true })
}
