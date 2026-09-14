import {
  DOMAIN_OWNERSHIP_DEFAULT_EXPIRATION_SECS,
  DOMAIN_OWNERSHIP_METHOD,
  DOMAIN_OWNERSHIP_SCHEMA_DEF,
  DOMAIN_OWNERSHIP_SCHEMA_NAME,
  DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE,
  assessDomainOwnership,
  decodeDomainOwnershipData,
  getDomainOwnershipFromEas,
  hashDomainOwnershipChallenge,
  type DomainOwnershipAssessResult,
  type DomainOwnershipDecoded,
} from '@seedprotocol/eas'
import { SchemaEncoder, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { prepareEasAttest, prepareEasMultiRevoke } from '~/helpers/easDirect'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getPublishConfig } from '~/config'
import {
  isPublishWallet,
  isSeedTxSender,
  type PublishWallet,
  type SeedTxSender,
} from '~/helpers/seedSigner'
import { getAttestationUidFromReceipt } from '~/helpers/easDirect'
import { normalizeBytes32Hex, isValidEasAttestationUid } from '@seedprotocol/eas'
import {
  createDomainOwnershipChallenge,
  type DomainOwnershipChallenge,
} from './challenge'
import { verifyDomainOwnershipDns, type VerifyDomainOwnershipDnsResult } from './dnsVerify'
import {
  fingerprintFromRegistrySnapshot,
  lookupDomainRegistry,
  normalizeRegistrableDomain,
  type DomainRegistrySnapshot,
} from './registry'

export {
  DOMAIN_OWNERSHIP_SCHEMA_DEF,
  DOMAIN_OWNERSHIP_SCHEMA_NAME,
  DOMAIN_OWNERSHIP_METHOD,
} from '@seedprotocol/eas'

export { createDomainOwnershipChallenge }
export type { DomainOwnershipChallenge }
export { verifyDomainOwnershipDns }
export type { VerifyDomainOwnershipDnsResult }
export { lookupDomainRegistry, normalizeRegistrableDomain, fingerprintFromRegistrySnapshot }
export type { DomainRegistrySnapshot }

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true

function resolveTxSender(account: PublishWallet | SeedTxSender): SeedTxSender {
  if (isPublishWallet(account)) return account.txSender
  if (isSeedTxSender(account)) return account
  throw new Error(
    '@seedprotocol/publish: domain ownership write APIs require a PublishWallet or SeedTxSender',
  )
}

async function sendAndWait(
  txSender: SeedTxSender,
  tx: Parameters<SeedTxSender['sendTransaction']>[0],
) {
  const result = await txSender.sendTransaction(tx)
  return waitForPublishReceipt(result.transactionHash)
}

/** Deterministic on-chain schema UID for {@link DOMAIN_OWNERSHIP_SCHEMA_DEF}. */
export function getDomainOwnershipSchemaUid(): `0x${string}` {
  return SchemaRegistry.getSchemaUID(
    DOMAIN_OWNERSHIP_SCHEMA_DEF,
    RESOLVER_ADDRESS as `0x${string}`,
    REVOCABLE,
  ) as `0x${string}`
}

/**
 * Registers the DomainOwnership EAS schema (if missing) and creates a Schema #1 name attestation.
 */
export async function ensureDomainOwnershipSchema(
  account: PublishWallet | SeedTxSender,
): Promise<`0x${string}`> {
  const sender = resolveTxSender(account)
  const schemaUid = getDomainOwnershipSchemaUid()
  const onChain = await getSchemaRecord(schemaUid)
  if (!onChain) {
    await sendAndWait(
      sender,
      registerSchema({
        schema: DOMAIN_OWNERSHIP_SCHEMA_DEF,
        resolverAddress: RESOLVER_ADDRESS,
        revocable: REVOCABLE,
      }),
    )
    await sendAndWait(
      sender,
      prepareNameSchemaAttestation({
        schemaUid,
        schemaName: DOMAIN_OWNERSHIP_SCHEMA_NAME,
      }),
    )
  }
  return schemaUid
}

export function encodeDomainOwnershipAttestationData(params: {
  domain: string
  claimer: string
  method: string
  challengeHash: string
  verifiedAt: number
  registryCreationDate: string
  registryExpirationDate: string
  registryFingerprint: string
  scope: string
}): `0x${string}` {
  const schemaEncoder = new SchemaEncoder(DOMAIN_OWNERSHIP_SCHEMA_DEF)
  const encodedData = schemaEncoder.encodeData([
    { name: 'domain', value: params.domain, type: 'string' },
    { name: 'claimer', value: params.claimer as `0x${string}`, type: 'address' },
    { name: 'method', value: params.method, type: 'string' },
    {
      name: 'challengeHash',
      value: normalizeBytes32Hex(params.challengeHash) as `0x${string}`,
      type: 'bytes32',
    },
    { name: 'verifiedAt', value: params.verifiedAt, type: 'uint64' },
    { name: 'registryCreationDate', value: params.registryCreationDate, type: 'string' },
    {
      name: 'registryExpirationDate',
      value: params.registryExpirationDate,
      type: 'string',
    },
    {
      name: 'registryFingerprint',
      value: normalizeBytes32Hex(params.registryFingerprint) as `0x${string}`,
      type: 'bytes32',
    },
    { name: 'scope', value: params.scope, type: 'string' },
  ])
  return encodedData as `0x${string}`
}

export type AttestDomainOwnershipParams = {
  wallet: PublishWallet | SeedTxSender
  domain: string
  claimer: string
  challengeHash: string
  registrySnapshot: DomainRegistrySnapshot
  scope?: string
  method?: string
  verifiedAt?: number
  /** When true (default), register + name the schema if missing. */
  ensureSchema?: boolean
  /** Override EAS expirationTime (unix seconds). */
  expirationTime?: number
}

export type AttestDomainOwnershipResult = {
  uid: `0x${string}`
  schemaUid: `0x${string}`
  challengeHash: `0x${string}`
  registryFingerprint: `0x${string}`
  verifiedAt: number
  expirationTime: number
}

function resolveExpirationTime(params: {
  verifiedAt: number
  registryExpirationDate?: string
  override?: number
}): number {
  if (typeof params.override === 'number' && params.override > 0) return params.override
  if (params.registryExpirationDate) {
    const ms = Date.parse(params.registryExpirationDate)
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000)
  }
  return params.verifiedAt + DOMAIN_OWNERSHIP_DEFAULT_EXPIRATION_SECS
}

/**
 * Tool wallet attests domain ownership after off-chain DNS + RDAP verification.
 */
export async function attestDomainOwnership(
  params: AttestDomainOwnershipParams,
): Promise<AttestDomainOwnershipResult> {
  const sender = resolveTxSender(params.wallet)
  const schemaUid =
    params.ensureSchema === false
      ? getDomainOwnershipSchemaUid()
      : await ensureDomainOwnershipSchema(params.wallet)

  const domain = normalizeRegistrableDomain(params.domain)
  const claimer = params.claimer.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(claimer)) {
    throw new Error('@seedprotocol/publish: attestDomainOwnership requires a valid claimer address')
  }

  const challengeHash = normalizeBytes32Hex(params.challengeHash) as `0x${string}`
  if (challengeHash === ZERO_BYTES32) {
    throw new Error('@seedprotocol/publish: attestDomainOwnership requires a non-zero challengeHash')
  }

  const verifiedAt = params.verifiedAt ?? Math.floor(Date.now() / 1000)
  const registryFingerprint = fingerprintFromRegistrySnapshot({
    domain,
    creationDate: params.registrySnapshot.creationDate ?? '',
    registrarIanaId: params.registrySnapshot.registrarIanaId ?? '',
  })
  const registryCreationDate = params.registrySnapshot.creationDate ?? ''
  const registryExpirationDate = params.registrySnapshot.expirationDate ?? ''
  const scope = params.scope ?? DOMAIN_OWNERSHIP_SCOPE_REGISTRABLE
  const method = params.method ?? DOMAIN_OWNERSHIP_METHOD
  const expirationTime = resolveExpirationTime({
    verifiedAt,
    registryExpirationDate,
    override: params.expirationTime,
  })

  const data = encodeDomainOwnershipAttestationData({
    domain,
    claimer,
    method,
    challengeHash,
    verifiedAt,
    registryCreationDate,
    registryExpirationDate,
    registryFingerprint,
    scope,
  })

  const tx = prepareEasAttest({
    schema: schemaUid,
    data: {
      recipient: claimer as `0x${string}`,
      expirationTime: BigInt(expirationTime),
      revocable: true,
      refUID: ZERO_BYTES32 as `0x${string}`,
      data,
      value: 0n,
    },
  })

  const receipt = await sendAndWait(sender, tx)
  if (!receipt) {
    throw new Error('@seedprotocol/publish: attestDomainOwnership failed — no receipt')
  }
  const { easContractAddress } = getPublishConfig()
  const uid = getAttestationUidFromReceipt(receipt, easContractAddress)
  if (!uid || !isValidEasAttestationUid(uid)) {
    throw new Error(
      '@seedprotocol/publish: attestDomainOwnership failed — could not parse attestation UID',
    )
  }

  return {
    uid: uid as `0x${string}`,
    schemaUid,
    challengeHash,
    registryFingerprint,
    verifiedAt,
    expirationTime,
  }
}

/**
 * Revoke a DomainOwnership sidecar attestation (must be signed by the original tool attester).
 */
export async function revokeDomainOwnership(params: {
  wallet: PublishWallet | SeedTxSender
  uid: string
  schemaUid?: string
}): Promise<void> {
  const sender = resolveTxSender(params.wallet)
  const schemaUid = (params.schemaUid ?? getDomainOwnershipSchemaUid()) as `0x${string}`
  const uid = normalizeBytes32Hex(params.uid) as `0x${string}`
  if (!isValidEasAttestationUid(uid)) {
    throw new Error('@seedprotocol/publish: revokeDomainOwnership requires a valid attestation uid')
  }

  const tx = prepareEasMultiRevoke([
    {
      schema: schemaUid,
      data: [{ uid }],
    },
  ])
  const receipt = await sendAndWait(sender, tx)
  if (!receipt) {
    throw new Error('@seedprotocol/publish: revokeDomainOwnership failed — no receipt')
  }
}

export type VerifyDomainOwnershipChallengeResult = {
  ok: boolean
  dns: VerifyDomainOwnershipDnsResult
  registrySnapshot: DomainRegistrySnapshot | null
  challengeHash: `0x${string}`
  error?: string
}

/**
 * Verify DNS TXT for a caller-held challenge and fetch an RDAP registry snapshot.
 * Does not write an attestation.
 */
export async function verifyDomainOwnershipChallenge(params: {
  challenge: DomainOwnershipChallenge
  /** Injected DNS lookups for tests. */
  dnsLookups?: Array<
    (name: string) => Promise<{ source: string; values: string[]; dnssecAuthenticated?: boolean }>
  >
  /** Injected registry lookup for tests. */
  registryLookup?: (domain: string) => Promise<DomainRegistrySnapshot | null>
  now?: number
}): Promise<VerifyDomainOwnershipChallengeResult> {
  const { challenge } = params
  const expectedHash = hashDomainOwnershipChallenge({
    domain: challenge.domain,
    claimer: challenge.claimer,
    token: challenge.token,
    scope: challenge.scope,
  })
  if (normalizeBytes32Hex(expectedHash) !== normalizeBytes32Hex(challenge.challengeHash)) {
    return {
      ok: false,
      dns: { ok: false, matchedSources: [], lookups: [], error: 'challengeHash mismatch' },
      registrySnapshot: null,
      challengeHash: expectedHash,
      error: 'Challenge hash does not match domain/claimer/token/scope',
    }
  }

  const dns = await verifyDomainOwnershipDns(challenge, {
    lookups: params.dnsLookups,
    now: params.now,
  })
  if (!dns.ok) {
    return {
      ok: false,
      dns,
      registrySnapshot: null,
      challengeHash: expectedHash,
      error: dns.error ?? 'DNS verification failed',
    }
  }

  const registryLookup = params.registryLookup ?? lookupDomainRegistry
  let registrySnapshot: DomainRegistrySnapshot | null
  try {
    registrySnapshot = await registryLookup(challenge.domain)
  } catch {
    registrySnapshot = null
  }

  if (!registrySnapshot) {
    return {
      ok: false,
      dns,
      registrySnapshot: null,
      challengeHash: expectedHash,
      error: 'Registry lookup failed',
    }
  }

  return {
    ok: true,
    dns,
    registrySnapshot,
    challengeHash: expectedHash,
  }
}

export type VerifyAndAttestDomainOwnershipResult = AttestDomainOwnershipResult & {
  registrySnapshot: DomainRegistrySnapshot
  dns: VerifyDomainOwnershipDnsResult
}

/**
 * Verify DNS + RDAP, then attest from the tool wallet.
 */
export async function verifyAndAttestDomainOwnership(params: {
  challenge: DomainOwnershipChallenge
  wallet: PublishWallet | SeedTxSender
  ensureSchema?: boolean
  dnsLookups?: Array<
    (name: string) => Promise<{ source: string; values: string[]; dnssecAuthenticated?: boolean }>
  >
  registryLookup?: (domain: string) => Promise<DomainRegistrySnapshot | null>
  now?: number
}): Promise<VerifyAndAttestDomainOwnershipResult> {
  const verified = await verifyDomainOwnershipChallenge({
    challenge: params.challenge,
    dnsLookups: params.dnsLookups,
    registryLookup: params.registryLookup,
    now: params.now,
  })
  if (!verified.ok || !verified.registrySnapshot) {
    throw new Error(
      `@seedprotocol/publish: verifyAndAttestDomainOwnership failed — ${verified.error ?? 'verification failed'}`,
    )
  }

  const attested = await attestDomainOwnership({
    wallet: params.wallet,
    domain: params.challenge.domain,
    claimer: params.challenge.claimer,
    challengeHash: verified.challengeHash,
    registrySnapshot: verified.registrySnapshot,
    scope: params.challenge.scope,
    method: params.challenge.method,
    ensureSchema: params.ensureSchema,
  })

  return {
    ...attested,
    registrySnapshot: verified.registrySnapshot,
    dns: verified.dns,
  }
}

export type AssessDomainOwnershipLiveResult = DomainOwnershipAssessResult & {
  decoded: DomainOwnershipDecoded
  uid: string
  registrySnapshot: DomainRegistrySnapshot | null
}

/**
 * Load a DomainOwnership attestation (by UID via tool allowlist query) and recheck RDAP.
 */
export async function assessDomainOwnershipLive(params: {
  uid: string
  toolAddresses: string[]
  schemaUid?: string
  registryLookup?: (domain: string) => Promise<DomainRegistrySnapshot | null>
  now?: number
}): Promise<AssessDomainOwnershipLiveResult> {
  const rows = await getDomainOwnershipFromEas({
    toolAddresses: params.toolAddresses,
    schemaUid: params.schemaUid,
    excludeRevoked: true,
  })
  const row = rows.find((r) => normalizeBytes32Hex(r.id) === normalizeBytes32Hex(params.uid))
  if (!row) {
    throw new Error(
      '@seedprotocol/publish: assessDomainOwnershipLive could not find attestation for uid/toolAddresses',
    )
  }
  const decoded = decodeDomainOwnershipData(row.decodedDataJson ?? '[]')
  const registryLookup = params.registryLookup ?? lookupDomainRegistry
  let registrySnapshot: DomainRegistrySnapshot | null
  try {
    registrySnapshot = await registryLookup(decoded.domain)
  } catch {
    registrySnapshot = null
  }

  const assessed = assessDomainOwnership({
    decoded,
    registrySnapshot,
    now: params.now,
  })

  return {
    ...assessed,
    decoded,
    uid: row.id,
    registrySnapshot,
  }
}
