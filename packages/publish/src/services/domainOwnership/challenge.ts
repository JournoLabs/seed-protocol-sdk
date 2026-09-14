import { randomBytes } from 'node:crypto'
import {
  DOMAIN_OWNERSHIP_CHALLENGE_TTL_MS,
  DOMAIN_OWNERSHIP_METHOD,
  DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
  buildDomainOwnershipTxtValue,
  domainOwnershipTxtName,
  hashDomainOwnershipChallenge,
} from '@seedprotocol/eas'
import { normalizeRegistrableDomain } from './registry'

export type DomainOwnershipChallenge = {
  /** Opaque id for caller correlation (not required by verify). */
  challengeId: string
  domain: string
  claimer: string
  scope: string
  method: typeof DOMAIN_OWNERSHIP_METHOD
  /** Raw challenge token (keep private until DNS publish; discard after verify). */
  token: string
  txtName: string
  txtValue: string
  challengeHash: `0x${string}`
  /** ISO-8601 expiry encoded in the TXT record. */
  expiresAt: string
  /** Suggested dig command for operators. */
  digHint: string
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

/**
 * Create a caller-held DNS TXT challenge for domain ownership verification.
 * The caller must persist the returned object and pass it to verify.
 * Domains are normalized to eTLD+1 (registrable) by default.
 */
export function createDomainOwnershipChallenge(params: {
  domain: string
  claimer: string
  scope?: string
  /** Override challenge TTL (ms). Default 72h. */
  ttlMs?: number
  now?: number
  /** When false, skip eTLD+1 normalization (hostname scope). Default true. */
  normalizeRegistrable?: boolean
}): DomainOwnershipChallenge {
  const domain =
    params.normalizeRegistrable === false
      ? params.domain.trim().toLowerCase().replace(/\.$/, '')
      : normalizeRegistrableDomain(params.domain)
  if (!domain || domain.includes(' ')) {
    throw new Error('@seedprotocol/publish: createDomainOwnershipChallenge requires a valid domain')
  }
  const claimer = params.claimer.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(claimer)) {
    throw new Error(
      '@seedprotocol/publish: createDomainOwnershipChallenge requires a 20-byte hex claimer address',
    )
  }
  const scope = params.scope ?? DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE
  const ttlMs = params.ttlMs ?? DOMAIN_OWNERSHIP_CHALLENGE_TTL_MS
  const now = params.now ?? Date.now()
  const expiresAt = new Date(now + ttlMs).toISOString()
  const token = base64Url(randomBytes(32))
  const challengeHash = hashDomainOwnershipChallenge({
    domain,
    claimer,
    token,
    scope,
  })
  const txtName = domainOwnershipTxtName(domain)
  const txtValue = buildDomainOwnershipTxtValue({
    token,
    claimer,
    expiry: expiresAt,
  })
  const challengeId = base64Url(randomBytes(16))

  return {
    challengeId,
    domain,
    claimer,
    scope,
    method: DOMAIN_OWNERSHIP_METHOD,
    token,
    txtName,
    txtValue,
    challengeHash,
    expiresAt,
    digHint: `dig TXT ${txtName}`,
  }
}
