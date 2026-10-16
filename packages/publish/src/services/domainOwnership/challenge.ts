import {
  DOMAIN_OWNERSHIP_CHALLENGE_TTL_MS,
  DOMAIN_OWNERSHIP_METHOD,
  DOMAIN_OWNERSHIP_SCOPE_HOSTNAME,
  DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
  buildDomainOwnershipTxtValue,
  domainOwnershipTxtName,
  hashDomainOwnershipChallenge,
} from '@seedprotocol/eas'
import { normalizeHostname, normalizeRegistrableDomain } from './registry'

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

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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
  /**
   * When false, skip eTLD+1 normalization: the challenge is on the hostname as given, and the
   * scope defaults to {@link DOMAIN_OWNERSHIP_SCOPE_HOSTNAME}. Default true.
   */
  normalizeRegistrable?: boolean
}): DomainOwnershipChallenge {
  const hostnameOnly = params.normalizeRegistrable === false
  const domain = hostnameOnly ? normalizeHostname(params.domain) : normalizeRegistrableDomain(params.domain)
  if (!domain || domain.includes(' ')) {
    throw new Error('@seedprotocol/publish: createDomainOwnershipChallenge requires a valid domain')
  }
  const claimer = params.claimer.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(claimer)) {
    throw new Error(
      '@seedprotocol/publish: createDomainOwnershipChallenge requires a 20-byte hex claimer address',
    )
  }
  const scope =
    params.scope ?? (hostnameOnly ? DOMAIN_OWNERSHIP_SCOPE_HOSTNAME : DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE)
  // A TXT record on a subdomain proves nothing about the rest of the registrable domain.
  if (scope === DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE && domain !== normalizeRegistrableDomain(domain)) {
    throw new Error(
      `@seedprotocol/publish: createDomainOwnershipChallenge cannot use scope "registrable" for "${domain}", which is not a registrable domain. Use the hostname scope or challenge ${normalizeRegistrableDomain(domain)}.`,
    )
  }
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
