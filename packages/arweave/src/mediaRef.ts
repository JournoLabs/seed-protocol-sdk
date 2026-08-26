import { BaseArweaveClient } from './ArweaveClient/BaseArweaveClient.js'
import {
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from './relationSeedRef.js'

export type FeedFieldRole = 'image' | 'file' | 'html' | 'text'

export type FeedFieldDescriptor = {
  role: FeedFieldRole
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

  if (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('blob:') ||
    s.startsWith('data:')
  ) {
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
    const camel =
      parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
    const alt2 = coalesceStringField(item, camel)
    if (alt2) return alt2
  }
  return ''
}

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

export function getArweaveUrlForTransaction(transactionId: string): string {
  return `${BaseArweaveClient.getBaseUrl()}/${transactionId}`
}
