import { keccak256 } from 'js-sha3'
import { normalizeBytes32Hex } from './easUid.js'
import { checksumAddress } from './utils.js'

/** EAS schema definition for tool domain-ownership sidecar attestations (revocable). */
export const DOMAIN_OWNERSHIP_SCHEMA_DEF =
  'string domain,address claimer,string method,bytes32 challengeHash,uint64 verifiedAt,string registryCreationDate,string registryExpirationDate,bytes32 registryFingerprint,string scope'

/** Schema #1 display name for {@link DOMAIN_OWNERSHIP_SCHEMA_DEF}. */
export const DOMAIN_OWNERSHIP_SCHEMA_NAME = 'seedprotocol.domainOwnership'

/** Challenge method stored on-chain. */
export const DOMAIN_OWNERSHIP_METHOD = 'dns-txt-challenge'

/** Default scope: registrable domain (eTLD+1). */
export const DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE = 'registrable'

/** Underscored DNS owner-name prefix (IETF domain control validation style). */
export const DOMAIN_OWNERSHIP_TXT_LABEL = '_seedprotocol-challenge'

/** Default challenge lifetime (72 hours). */
export const DOMAIN_OWNERSHIP_CHALLENGE_TTL_MS = 72 * 60 * 60 * 1000

/** Soft staleness window when no live registry snapshot is available (365 days). */
export const DOMAIN_OWNERSHIP_SOFT_STALE_MS = 365 * 24 * 60 * 60 * 1000

/** Fallback EAS expiration when RDAP has no expirationDate (365 days from verifiedAt). */
export const DOMAIN_OWNERSHIP_DEFAULT_EXPIRATION_SECS = 365 * 24 * 60 * 60

export type DomainOwnershipDecoded = {
  domain: string
  claimer: string
  method: string
  challengeHash: `0x${string}`
  verifiedAt: number
  registryCreationDate: string
  registryExpirationDate: string
  registryFingerprint: `0x${string}`
  scope: string
}

export type DomainOwnershipTxtParts = {
  token: string
  claimer: string
  expiry: string
}

export type DomainRegistryFingerprintInput = {
  domain: string
  creationDate?: string | null
  registrarIanaId?: string | null
}

export type DomainOwnershipAssessStatus =
  | 'valid'
  | 'expired'
  | 'likely_transferred'
  | 'stale'
  | 'unknown'

export type DomainOwnershipAssessResult = {
  status: DomainOwnershipAssessStatus
  warnings: string[]
}

type DecodedField = {
  name?: string
  value?: unknown
  type?: string
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

function normalizeClaimer(claimer: string): string {
  const trimmed = claimer.trim()
  try {
    return checksumAddress(trimmed).toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

/**
 * DNS owner name for the challenge TXT record.
 * Example: `_seedprotocol-challenge.example.com`
 */
export function domainOwnershipTxtName(domain: string): string {
  return `${DOMAIN_OWNERSHIP_TXT_LABEL}.${normalizeDomain(domain)}`
}

/**
 * Build IETF-style key=value TXT RDATA for a domain ownership challenge.
 */
export function buildDomainOwnershipTxtValue(params: {
  token: string
  claimer: string
  expiry: string
}): string {
  const claimer = normalizeClaimer(params.claimer)
  return `token=${params.token},addr=${claimer},expiry=${params.expiry}`
}

/**
 * Parse a domain ownership TXT RDATA value. Returns null when required keys are missing.
 */
export function parseDomainOwnershipTxtValue(value: string): DomainOwnershipTxtParts | null {
  const raw = value.replace(/^"+|"+$/g, '').trim()
  const parts = new Map<string, string>()
  for (const segment of raw.split(',')) {
    const idx = segment.indexOf('=')
    if (idx <= 0) continue
    const key = segment.slice(0, idx).trim()
    const val = segment.slice(idx + 1).trim()
    if (key) parts.set(key, val)
  }
  const token = parts.get('token')
  const claimer = parts.get('addr') ?? parts.get('claimer')
  const expiry = parts.get('expiry')
  if (!token || !claimer || !expiry) return null
  return { token, claimer: normalizeClaimer(claimer), expiry }
}

/**
 * Deterministic challenge hash: keccak256 of canonical UTF-8 material.
 * Material: `domain|claimer|token|scope` (lowercased domain/claimer).
 */
export function hashDomainOwnershipChallenge(params: {
  domain: string
  claimer: string
  token: string
  scope?: string
}): `0x${string}` {
  const domain = normalizeDomain(params.domain)
  const claimer = normalizeClaimer(params.claimer)
  const scope = (params.scope ?? DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE).trim()
  const material = `${domain}|${claimer}|${params.token}|${scope}`
  return ('0x' + keccak256(utf8Bytes(material))) as `0x${string}`
}

/**
 * Deterministic registry fingerprint from stable RDAP fields.
 * Uses domain + creationDate + registrar IANA id (empty string when missing).
 */
export function hashDomainRegistryFingerprint(
  input: DomainRegistryFingerprintInput,
): `0x${string}` {
  const payload = {
    domain: normalizeDomain(input.domain),
    creationDate: (input.creationDate ?? '').trim(),
    registrarIanaId: (input.registrarIanaId ?? '').trim(),
  }
  return ('0x' + keccak256(utf8Bytes(JSON.stringify(payload)))) as `0x${string}`
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
 * Decode DomainOwnership fields from EAS `decodedDataJson` or a JSON array of named fields.
 */
export function decodeDomainOwnershipData(
  data: string | DecodedField[],
): DomainOwnershipDecoded {
  const fields: DecodedField[] =
    typeof data === 'string' ? (JSON.parse(data) as DecodedField[]) : data
  const byName = new Map<string, DecodedField>()
  for (const f of fields) {
    if (f?.name) byName.set(f.name, f)
  }

  return {
    domain: normalizeDomain(asString(byName.get('domain')?.value)),
    claimer: normalizeClaimer(asString(byName.get('claimer')?.value)),
    method: asString(byName.get('method')?.value),
    challengeHash: asBytes32(byName.get('challengeHash')?.value),
    verifiedAt: asUint64(byName.get('verifiedAt')?.value),
    registryCreationDate: asString(byName.get('registryCreationDate')?.value),
    registryExpirationDate: asString(byName.get('registryExpirationDate')?.value),
    registryFingerprint: asBytes32(byName.get('registryFingerprint')?.value),
    scope: asString(byName.get('scope')?.value),
  }
}

function isoToUnixSeconds(iso: string): number | null {
  if (!iso?.trim()) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return Math.floor(ms / 1000)
}

/**
 * Pure validity assessment for a decoded domain-ownership attestation.
 *
 * - `registrySnapshot === undefined`: no live recheck; may return `stale`
 * - `registrySnapshot === null`: live lookup failed; returns `unknown` (unless expired)
 * - object snapshot: compares fingerprint → `likely_transferred` on mismatch
 */
export function assessDomainOwnership(params: {
  decoded: DomainOwnershipDecoded
  /** EAS on-chain expirationTime (unix seconds), when known. */
  expirationTime?: number | null
  now?: number
  registrySnapshot?: DomainRegistryFingerprintInput | null
  softStaleMs?: number
}): DomainOwnershipAssessResult {
  const nowSec = Math.floor((params.now ?? Date.now()) / 1000)
  const warnings: string[] = []
  const softStaleMs = params.softStaleMs ?? DOMAIN_OWNERSHIP_SOFT_STALE_MS

  const easExp = params.expirationTime
  const registryExp = isoToUnixSeconds(params.decoded.registryExpirationDate)
  const expiredByEas =
    typeof easExp === 'number' && easExp > 0 && nowSec >= easExp
  const expiredByRegistry = registryExp != null && nowSec >= registryExp
  if (expiredByEas || expiredByRegistry) {
    return { status: 'expired', warnings }
  }

  if (params.registrySnapshot === null) {
    warnings.push('Registry lookup unavailable; ownership status is unknown')
    return { status: 'unknown', warnings }
  }

  if (params.registrySnapshot !== undefined) {
    const expected = hashDomainRegistryFingerprint({
      domain: params.decoded.domain,
      creationDate: params.registrySnapshot.creationDate,
      registrarIanaId: params.registrySnapshot.registrarIanaId,
    })
    if (
      normalizeBytes32Hex(expected) !==
      normalizeBytes32Hex(params.decoded.registryFingerprint)
    ) {
      warnings.push(
        'Registry creation date or registrar IANA id no longer matches attestation fingerprint',
      )
      return { status: 'likely_transferred', warnings }
    }
    return { status: 'valid', warnings }
  }

  const nowMs = params.now ?? Date.now()
  const verifiedAtMs = params.decoded.verifiedAt * 1000
  if (Number.isFinite(verifiedAtMs) && verifiedAtMs > 0 && nowMs - verifiedAtMs > softStaleMs) {
    warnings.push(
      'Attestation is older than the soft staleness window and was not rechecked against the registry',
    )
    return { status: 'stale', warnings }
  }

  return { status: 'valid', warnings }
}
