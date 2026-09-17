import { keccak256 } from 'js-sha3'
import { normalizeBytes32Hex } from './easUid.js'
import { checksumAddress } from './utils.js'

/** EAS schema definition for ManagedAccount publish-automation grants (revocable). */
export const PUBLISH_AUTHORIZATION_SCHEMA_DEF =
  'address identity,address sessionKey,address app,string scopes,uint64 grantedAt,uint64 expiresAt,bytes32 permissionsHash'

/** Schema #1 display name for {@link PUBLISH_AUTHORIZATION_SCHEMA_DEF}. */
export const PUBLISH_AUTHORIZATION_SCHEMA_NAME = 'seedprotocol.publishAuthorization'

/** Fixed v1 scopes string. */
export const PUBLISH_AUTHORIZATION_SCOPES = 'publish,revoke'

/** Default EAS expiration when grant has no expiresAt (365 days from grantedAt). */
export const PUBLISH_AUTHORIZATION_DEFAULT_EXPIRATION_SECS = 365 * 24 * 60 * 60

export type PublishAuthorizationDecoded = {
  identity: string
  sessionKey: string
  app: string
  scopes: string
  grantedAt: number
  expiresAt: number
  permissionsHash: `0x${string}`
}

export type PublishAuthorizationAssessStatus = 'valid' | 'expired' | 'scope_mismatch' | 'unknown'

export type PublishAuthorizationAssessResult = {
  status: PublishAuthorizationAssessStatus
  warnings: string[]
}

type DecodedField = {
  name?: string
  value?: unknown
  type?: string
}

function normalizeAddress(addr: string): string {
  const trimmed = addr.trim()
  try {
    return checksumAddress(trimmed).toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

function asBytes32(value: unknown): `0x${string}` {
  if (typeof value === 'string') return normalizeBytes32Hex(value) as `0x${string}`
  if (value && typeof value === 'object' && 'hex' in (value as object)) {
    return normalizeBytes32Hex(String((value as { hex: string }).hex)) as `0x${string}`
  }
  return normalizeBytes32Hex(String(value ?? '')) as `0x${string}`
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    return String((value as { value: unknown }).value ?? '')
  }
  return String(value ?? '')
}

function asUint64(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : 0
  }
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    return asUint64((value as { value: unknown }).value)
  }
  return 0
}

/**
 * Decode PublishAuthorization fields from EAS `decodedDataJson` or a JSON array of named fields.
 */
export function decodePublishAuthorizationData(
  data: string | DecodedField[],
): PublishAuthorizationDecoded {
  const fields: DecodedField[] =
    typeof data === 'string' ? (JSON.parse(data) as DecodedField[]) : data
  const byName = new Map<string, DecodedField>()
  for (const f of fields) {
    if (f?.name) byName.set(f.name, f)
  }

  return {
    identity: normalizeAddress(asString(byName.get('identity')?.value)),
    sessionKey: normalizeAddress(asString(byName.get('sessionKey')?.value)),
    app: normalizeAddress(asString(byName.get('app')?.value)),
    scopes: asString(byName.get('scopes')?.value),
    grantedAt: asUint64(byName.get('grantedAt')?.value),
    expiresAt: asUint64(byName.get('expiresAt')?.value),
    permissionsHash: asBytes32(byName.get('permissionsHash')?.value),
  }
}

/**
 * Pure validity assessment for a decoded publish-authorization attestation.
 */
export function assessPublishAuthorization(params: {
  decoded: PublishAuthorizationDecoded
  /** EAS on-chain expirationTime (unix seconds), when known. */
  expirationTime?: number | null
  now?: number
  /** When set, scopes must equal this string (default: publish,revoke). */
  expectedScopes?: string
}): PublishAuthorizationAssessResult {
  const nowSec = Math.floor((params.now ?? Date.now()) / 1000)
  const warnings: string[] = []
  const expectedScopes = params.expectedScopes ?? PUBLISH_AUTHORIZATION_SCOPES

  const easExp = params.expirationTime
  const grantExp = params.decoded.expiresAt
  const expiredByEas = typeof easExp === 'number' && easExp > 0 && nowSec >= easExp
  const expiredByGrant = grantExp > 0 && nowSec >= grantExp
  if (expiredByEas || expiredByGrant) {
    return { status: 'expired', warnings }
  }

  if (params.decoded.scopes.trim() !== expectedScopes.trim()) {
    warnings.push(`Unexpected scopes "${params.decoded.scopes}"; expected "${expectedScopes}"`)
    return { status: 'scope_mismatch', warnings }
  }

  if (!params.decoded.identity || !params.decoded.sessionKey) {
    warnings.push('Missing identity or sessionKey')
    return { status: 'unknown', warnings }
  }

  return { status: 'valid', warnings }
}

/** Re-export keccak helper used by tests / fingerprinting (permissions hash lives in publish). */
export function hashPublishAuthorizationMaterial(material: string): `0x${string}` {
  return ('0x' + keccak256(new TextEncoder().encode(material))) as `0x${string}`
}
