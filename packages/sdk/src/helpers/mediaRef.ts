import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { getStorageTransactionIdForSeedUid } from '@/db/read/getStorageTransactionIdForSeedUid'
import { BaseArweaveClient } from './ArweaveClient/BaseArweaveClient'
import { BaseFileManager } from './FileManager/BaseFileManager'
import {
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from './relationSeedRef'

const logger = debug('seedSdk:helpers:mediaRef')

/** Roles for feed/XML field manifests (shared with @seedprotocol/feed and @seedprotocol/react). */
export type FeedFieldRole = 'image' | 'file' | 'html' | 'text'

export type FeedFieldDescriptor = {
  role: FeedFieldRole
  /** When heuristics are wrong, force how `classifyMediaRef` interprets the raw string. */
  treatAs?: 'arweaveTx' | 'seedUid' | 'url'
}

export type FeedFieldManifest = Record<string, FeedFieldDescriptor>

export type ClassifyMediaRefOptions = {
  treatAs?: FeedFieldDescriptor['treatAs']
}

export type MediaRefClassification =
  | { kind: 'empty' }
  | { kind: 'url'; href: string }
  | { kind: 'seedUid'; uid: string }
  | { kind: 'seedLocalId'; localId: string }
  | { kind: 'arweaveTxId'; txId: string }
  | { kind: 'unknown'; raw: string }

export type ResolveMediaRefResult =
  | { status: 'ready'; href: string; source: 'direct' | 'gateway' | 'localBlob' }
  | { status: 'empty' }
  | {
      status: 'unresolved'
      reason: string
      classification: MediaRefClassification
    }

export type ResolveMediaRefOptions = ClassifyMediaRefOptions

/** Typical Arweave transaction id: 43 URL-safe base64 characters. */
const ARWEAVE_TX_ID = /^[a-zA-Z0-9_-]{43}$/

function trimOrEmpty(raw: string | undefined | null): string {
  if (raw == null) return ''
  return typeof raw === 'string' ? raw.trim() : String(raw).trim()
}

function coalesceStringField(item: Record<string, unknown>, key: string): string {
  const v = item[key]
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/**
 * Try JSON relation payloads and plain relation id strings.
 */
function unwrapRelationString(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  try {
    const parsed = JSON.parse(t) as unknown
    const fromObj = normalizeRelationPropertyValue(parsed)
    if (fromObj) return fromObj
  } catch {
    // not JSON
  }
  return t
}

/**
 * Pure, sync classification of a media-related string from feeds or XML.
 */
export function classifyMediaRef(
  raw: string,
  options?: ClassifyMediaRefOptions,
): MediaRefClassification {
  const s = trimOrEmpty(raw)
  if (!s) {
    return { kind: 'empty' }
  }

  const treatAs = options?.treatAs
  if (treatAs === 'url') {
    return { kind: 'url', href: s }
  }
  if (treatAs === 'arweaveTx') {
    return { kind: 'arweaveTxId', txId: s }
  }
  if (treatAs === 'seedUid') {
    if (s.startsWith('0x') && s.length === 66) {
      return { kind: 'seedUid', uid: s }
    }
    return { kind: 'unknown', raw: s }
  }

  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('blob:') || s.startsWith('data:')) {
    return { kind: 'url', href: s }
  }

  const unwrapped = unwrapRelationString(s)
  const ids = resolveSeedIdsFromRefString(unwrapped)
  if (ids.seedUid) {
    return { kind: 'seedUid', uid: ids.seedUid }
  }
  if (ids.seedLocalId) {
    return { kind: 'seedLocalId', localId: ids.seedLocalId }
  }

  if (unwrapped.startsWith('0x') && unwrapped.length === 66) {
    return { kind: 'seedUid', uid: unwrapped }
  }

  if (ARWEAVE_TX_ID.test(unwrapped) && !unwrapped.startsWith('0x')) {
    return { kind: 'arweaveTxId', txId: unwrapped }
  }

  return { kind: 'unknown', raw: s }
}

/**
 * Same as convertTxIdToImage but local to this module to avoid circular imports with helpers/index.
 */
async function tryLocalBlobUrlFromTxId(txId: string): Promise<string | undefined> {
  const imageFilePath = BaseFileManager.getFilesPath('images', txId)
  const fileExists = await BaseFileManager.pathExists(imageFilePath)
  if (!fileExists) {
    logger(`[tryLocalBlobUrlFromTxId] ${imageFilePath} does not exist`)
    return undefined
  }
  const buffer = await BaseFileManager.readFileAsBuffer(imageFilePath)

  let arrayBuffer: ArrayBuffer
  if (buffer instanceof Blob) {
    arrayBuffer = await buffer.arrayBuffer()
  } else if (buffer instanceof ArrayBuffer) {
    arrayBuffer = buffer
  } else {
    const sliced = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    if (sliced instanceof SharedArrayBuffer) {
      const uint8Array = new Uint8Array(sliced)
      arrayBuffer = uint8Array.buffer.slice(0) as unknown as ArrayBuffer
    } else {
      arrayBuffer = sliced as ArrayBuffer
    }
  }

  const uint = new Uint8Array(arrayBuffer)
  const imageBlob = new Blob([uint])
  return URL.createObjectURL(imageBlob)
}

async function resolveTxId(txId: string): Promise<ResolveMediaRefResult> {
  const local = await tryLocalBlobUrlFromTxId(txId)
  if (local) {
    return { status: 'ready', href: local, source: 'localBlob' }
  }
  return {
    status: 'ready',
    href: BaseArweaveClient.getRawUrl(txId),
    source: 'gateway',
  }
}

/**
 * Resolve a classified media reference to a display URL (https/blob/data), using local files when present.
 */
export async function resolveMediaRef(
  raw: string,
  options?: ResolveMediaRefOptions,
): Promise<ResolveMediaRefResult> {
  const classification = classifyMediaRef(raw, options)

  switch (classification.kind) {
    case 'empty':
      return { status: 'empty' }
    case 'url':
      return {
        status: 'ready',
        href: classification.href,
        source: 'direct',
      }
    case 'seedLocalId':
      return {
        status: 'unresolved',
        reason: 'seed_local_id_not_portable',
        classification,
      }
    case 'unknown':
      return {
        status: 'unresolved',
        reason: 'unknown_ref',
        classification,
      }
    case 'arweaveTxId':
      return resolveTxId(classification.txId)
    case 'seedUid': {
      const appDb = BaseDb.getAppDb()
      if (!appDb) {
        return {
          status: 'unresolved',
          reason: 'seed_uid_requires_app_db',
          classification,
        }
      }
      const storageTransactionId = await getStorageTransactionIdForSeedUid(classification.uid)
      if (!storageTransactionId) {
        return {
          status: 'unresolved',
          reason: 'seed_uid_no_storage_transaction',
          classification,
        }
      }
      return resolveTxId(storageTransactionId)
    }
    default:
      return {
        status: 'unresolved',
        reason: 'unknown_ref',
        classification,
      }
  }
}

export type NormalizedMediaField = {
  role: 'image' | 'file'
  raw: string
  classification: MediaRefClassification
}

export type NormalizedHtmlField = {
  role: 'html'
  raw: string
}

export type NormalizedTextField = {
  role: 'text'
  raw: string
}

export type NormalizedFeedFieldValue =
  | NormalizedMediaField
  | NormalizedHtmlField
  | NormalizedTextField

/**
 * Read a string field from a parsed item, trying camelCase and snake_case keys.
 */
export function getFeedItemStringField(item: Record<string, unknown>, key: string): string {
  const direct = coalesceStringField(item, key)
  if (direct) return direct
  const snake = key.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
  if (snake !== key) {
    const alt = coalesceStringField(item, snake)
    if (alt) return alt
  }
  const parts = key.split('_')
  if (parts.length > 1) {
    const camel = parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
    const alt2 = coalesceStringField(item, camel)
    if (alt2) return alt2
  }
  return ''
}

/**
 * Apply a field manifest to a plain feed item: classify media/file fields; pass through html/text.
 */
export function normalizeFeedItemFields(
  item: Record<string, unknown>,
  manifest: FeedFieldManifest,
): Record<string, NormalizedFeedFieldValue | undefined> {
  const out: Record<string, NormalizedFeedFieldValue | undefined> = {}
  for (const [fieldKey, descriptor] of Object.entries(manifest)) {
    const raw = getFeedItemStringField(item, fieldKey)
    if (!raw) {
      out[fieldKey] = undefined
      continue
    }
    if (descriptor.role === 'html') {
      out[fieldKey] = { role: 'html', raw }
      continue
    }
    if (descriptor.role === 'text') {
      out[fieldKey] = { role: 'text', raw }
      continue
    }
    const classification = classifyMediaRef(raw, { treatAs: descriptor.treatAs })
    out[fieldKey] = {
      role: descriptor.role,
      raw,
      classification,
    }
  }
  return out
}
