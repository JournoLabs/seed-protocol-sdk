import { BaseArweaveClient } from './ArweaveClient/BaseArweaveClient.js'
import { isEasAttestationExplorerUrl } from './easAttestationUrl.js'
import { classifyMediaRef } from './mediaRef.js'

export type SeedRssImageRelationRef = {
  storageTransactionId?: string
  arweaveUrl?: string
  seedUid?: string
  /** Gateway/raw URL suitable for image fetch; never an EAS attestation explorer page. */
  mediaUrl?: string
}

export const SEED_RSS_IMAGE_RELATION_FIELD_KEYS = [
  'featureImage',
  'feature_image',
  'image',
  'images',
  'coverImage',
  'cover_image',
  'thumbnail',
  'thumbnail_image',
  'thumbnailImage',
] as const

function trimOrEmpty(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function readObjectStringField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = trimOrEmpty(obj[key])
    if (direct) return direct
  }

  const suffixes = keys.map((key) => key.split(':').pop()!.toLowerCase())
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const normalizedKey = rawKey.includes(':') ? rawKey.split(':').pop()! : rawKey
    const normalizedLower = normalizedKey.toLowerCase()
    if (suffixes.some((suffix) => normalizedLower === suffix.toLowerCase())) {
      const value = trimOrEmpty(rawValue)
      if (value) return value
    }
  }

  return ''
}

function tryGatewayUrlForTxId(txId: string): string | undefined {
  const trimmed = txId.trim()
  if (!trimmed || trimmed.startsWith('0x')) return undefined
  try {
    return `${BaseArweaveClient.getBaseUrl()}/${trimmed}`
  } catch {
    return undefined
  }
}

function resolveMediaUrlFromParts(parts: {
  storageTransactionId?: string
  arweaveUrl?: string
}): string | undefined {
  const txId = parts.storageTransactionId?.trim()
  if (txId) {
    const fromTx = tryGatewayUrlForTxId(txId)
    if (fromTx) return fromTx
  }

  const arweaveUrl = parts.arweaveUrl?.trim()
  if (arweaveUrl && !isEasAttestationExplorerUrl(arweaveUrl)) {
    return arweaveUrl
  }

  return undefined
}

function resolveFromString(value: string): SeedRssImageRelationRef | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (isEasAttestationExplorerUrl(trimmed)) {
    return undefined
  }

  const classification = classifyMediaRef(trimmed)
  switch (classification.kind) {
    case 'url':
      return { mediaUrl: classification.href }
    case 'arweaveTxId': {
      const mediaUrl = tryGatewayUrlForTxId(classification.txId)
      return {
        storageTransactionId: classification.txId,
        ...(mediaUrl ? { mediaUrl } : {}),
      }
    }
    case 'seedUid':
      return { seedUid: classification.uid }
    default: {
      const mediaUrl = tryGatewayUrlForTxId(trimmed)
      if (mediaUrl) {
        return {
          storageTransactionId: trimmed,
          mediaUrl,
        }
      }
      return undefined
    }
  }
}

function resolveFromObject(obj: Record<string, unknown>): SeedRssImageRelationRef | undefined {
  const storageTransactionId = readObjectStringField(
    obj,
    'storageTransactionId',
    'storage_transaction_id',
  )
  const arweaveUrl = readObjectStringField(obj, 'arweaveUrl', 'arweave_url')
  const seedUid = readObjectStringField(obj, 'seedUid', 'SeedUid', 'seed_uid')
  const link = readObjectStringField(obj, 'link', 'Link')

  const mediaUrl =
    resolveMediaUrlFromParts({ storageTransactionId, arweaveUrl }) ??
    (link && !isEasAttestationExplorerUrl(link) ? link : undefined)

  if (!storageTransactionId && !arweaveUrl && !seedUid && !mediaUrl) {
    return undefined
  }

  return {
    ...(storageTransactionId ? { storageTransactionId } : {}),
    ...(arweaveUrl && !isEasAttestationExplorerUrl(arweaveUrl) ? { arweaveUrl } : {}),
    ...(seedUid ? { seedUid } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
  }
}

/**
 * Resolve a Seed RSS image relation value (plain string or expanded relation object)
 * using field priority: storageTransactionId → arweaveUrl/gateway URL → seedUid.
 * EAS attestation explorer URLs are never returned as media.
 */
export function resolveSeedRssImageRelationRef(value: unknown): SeedRssImageRelationRef | undefined {
  if (value == null) return undefined

  if (typeof value === 'string') {
    return resolveFromString(value)
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = resolveSeedRssImageRelationRef(entry)
      if (resolved?.mediaUrl || resolved?.storageTransactionId || resolved?.seedUid) {
        return resolved
      }
    }
    return undefined
  }

  if (typeof value === 'object') {
    return resolveFromObject(value as Record<string, unknown>)
  }

  return undefined
}

/**
 * Read the first configured image-relation field from a parsed RSS item record.
 */
export function resolveSeedRssImageRelationFromItem(
  item: Record<string, unknown>,
  fieldKeys: readonly string[] = SEED_RSS_IMAGE_RELATION_FIELD_KEYS,
): SeedRssImageRelationRef | undefined {
  for (const key of fieldKeys) {
    if (!(key in item)) continue
    const resolved = resolveSeedRssImageRelationRef(item[key])
    if (resolved) return resolved
  }
  return undefined
}
