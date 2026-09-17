import {
  PUBLISH_AUTHORIZATION_DEFAULT_EXPIRATION_SECS,
  PUBLISH_AUTHORIZATION_SCHEMA_DEF,
  PUBLISH_AUTHORIZATION_SCHEMA_NAME,
  PUBLISH_AUTHORIZATION_SCOPES,
  assessPublishAuthorization,
  decodePublishAuthorizationData,
  getPublishAuthorizationFromEas,
  type PublishAuthorizationAssessResult,
  type PublishAuthorizationDecoded,
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
  buildAutomationSessionKeyPermissions,
  hashAutomationSessionKeyPermissions,
  PUBLISH_AUTOMATION_SCOPES,
} from '~/helpers/automationSessionKeyPermissions'

export {
  PUBLISH_AUTHORIZATION_SCHEMA_DEF,
  PUBLISH_AUTHORIZATION_SCHEMA_NAME,
  PUBLISH_AUTHORIZATION_SCOPES,
} from '@seedprotocol/eas'

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function resolveTxSender(account: PublishWallet | SeedTxSender): SeedTxSender {
  if (isPublishWallet(account)) return account.txSender
  if (isSeedTxSender(account)) return account
  throw new Error(
    '@seedprotocol/publish: publish authorization write APIs require a PublishWallet or SeedTxSender',
  )
}

async function sendAndWait(
  txSender: SeedTxSender,
  tx: Parameters<SeedTxSender['sendTransaction']>[0],
) {
  const result = await txSender.sendTransaction(tx)
  return waitForPublishReceipt(result.transactionHash)
}

function assertAddress(label: string, addr: string): `0x${string}` {
  const t = addr.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) {
    throw new Error(`@seedprotocol/publish: ${label} must be a valid address`)
  }
  return t as `0x${string}`
}

/** Deterministic on-chain schema UID for {@link PUBLISH_AUTHORIZATION_SCHEMA_DEF}. */
export function getPublishAuthorizationSchemaUid(): `0x${string}` {
  return SchemaRegistry.getSchemaUID(
    PUBLISH_AUTHORIZATION_SCHEMA_DEF,
    RESOLVER_ADDRESS as `0x${string}`,
    REVOCABLE,
  ) as `0x${string}`
}

/**
 * Registers the PublishAuthorization EAS schema (if missing) and creates a Schema #1 name attestation.
 */
export async function ensurePublishAuthorizationSchema(
  account: PublishWallet | SeedTxSender,
): Promise<`0x${string}`> {
  const sender = resolveTxSender(account)
  const schemaUid = getPublishAuthorizationSchemaUid()
  const onChain = await getSchemaRecord(schemaUid)
  if (!onChain) {
    await sendAndWait(
      sender,
      registerSchema({
        schema: PUBLISH_AUTHORIZATION_SCHEMA_DEF,
        resolverAddress: RESOLVER_ADDRESS,
        revocable: REVOCABLE,
      }),
    )
    await sendAndWait(
      sender,
      prepareNameSchemaAttestation({
        schemaUid,
        schemaName: PUBLISH_AUTHORIZATION_SCHEMA_NAME,
      }),
    )
  }
  return schemaUid
}

export function encodePublishAuthorizationAttestationData(params: {
  identity: string
  sessionKey: string
  app: string
  scopes: string
  grantedAt: number
  expiresAt: number
  permissionsHash: string
}): `0x${string}` {
  const schemaEncoder = new SchemaEncoder(PUBLISH_AUTHORIZATION_SCHEMA_DEF)
  const encodedData = schemaEncoder.encodeData([
    { name: 'identity', value: params.identity as `0x${string}`, type: 'address' },
    { name: 'sessionKey', value: params.sessionKey as `0x${string}`, type: 'address' },
    { name: 'app', value: params.app as `0x${string}`, type: 'address' },
    { name: 'scopes', value: params.scopes, type: 'string' },
    { name: 'grantedAt', value: params.grantedAt, type: 'uint64' },
    { name: 'expiresAt', value: params.expiresAt, type: 'uint64' },
    {
      name: 'permissionsHash',
      value: normalizeBytes32Hex(params.permissionsHash) as `0x${string}`,
      type: 'bytes32',
    },
  ])
  return encodedData as `0x${string}`
}

export type AttestPublishAuthorizationParams = {
  /** Must be the ManagedAccount (identity) wallet — becomes EAS attester. */
  wallet: PublishWallet | SeedTxSender
  identity: string
  sessionKey: string
  /** Optional app label address; defaults to zero address. */
  app?: string
  scopes?: string
  grantedAt?: number
  expiresAt?: number
  permissionsHash?: string
  ensureSchema?: boolean
  /** Override EAS expirationTime (unix seconds). */
  expirationTime?: number
}

export type AttestPublishAuthorizationResult = {
  uid: `0x${string}`
  schemaUid: `0x${string}`
  permissionsHash: `0x${string}`
  grantedAt: number
  expiresAt: number
  expirationTime: number
}

/**
 * ManagedAccount attests a PublishAuthorization grant (recipient = session key).
 */
export async function attestPublishAuthorization(
  params: AttestPublishAuthorizationParams,
): Promise<AttestPublishAuthorizationResult> {
  const sender = resolveTxSender(params.wallet)
  const schemaUid =
    params.ensureSchema === false
      ? getPublishAuthorizationSchemaUid()
      : await ensurePublishAuthorizationSchema(params.wallet)

  const identity = assertAddress('identity', params.identity)
  const sessionKey = assertAddress('sessionKey', params.sessionKey)
  const app = params.app?.trim()
    ? assertAddress('app', params.app)
    : (ZERO_ADDRESS as `0x${string}`)

  const grantedAt = params.grantedAt ?? Math.floor(Date.now() / 1000)
  const expiresAt =
    typeof params.expiresAt === 'number' && params.expiresAt > 0
      ? Math.trunc(params.expiresAt)
      : 0
  const scopes = params.scopes ?? PUBLISH_AUTHORIZATION_SCOPES

  const permissionsHash = normalizeBytes32Hex(
    params.permissionsHash ??
      hashAutomationSessionKeyPermissions(
        buildAutomationSessionKeyPermissions({
          expiresAt: expiresAt > 0 ? expiresAt : undefined,
        }),
        scopes === PUBLISH_AUTHORIZATION_SCOPES ? PUBLISH_AUTOMATION_SCOPES : scopes,
      ),
  ) as `0x${string}`

  if (permissionsHash === ZERO_BYTES32) {
    throw new Error(
      '@seedprotocol/publish: attestPublishAuthorization requires a non-zero permissionsHash',
    )
  }

  const expirationTime =
    typeof params.expirationTime === 'number' && params.expirationTime > 0
      ? params.expirationTime
      : expiresAt > 0
        ? expiresAt
        : grantedAt + PUBLISH_AUTHORIZATION_DEFAULT_EXPIRATION_SECS

  const data = encodePublishAuthorizationAttestationData({
    identity,
    sessionKey,
    app,
    scopes,
    grantedAt,
    expiresAt,
    permissionsHash,
  })

  const tx = prepareEasAttest({
    schema: schemaUid,
    data: {
      recipient: sessionKey,
      expirationTime: BigInt(expirationTime),
      revocable: true,
      refUID: ZERO_BYTES32 as `0x${string}`,
      data,
      value: 0n,
    },
  })

  const receipt = await sendAndWait(sender, tx)
  if (!receipt) {
    throw new Error('@seedprotocol/publish: attestPublishAuthorization failed — no receipt')
  }
  const { easContractAddress } = getPublishConfig()
  const uid = getAttestationUidFromReceipt(receipt, easContractAddress)
  if (!uid || !isValidEasAttestationUid(uid)) {
    throw new Error(
      '@seedprotocol/publish: attestPublishAuthorization failed — could not parse attestation UID',
    )
  }

  return {
    uid: uid as `0x${string}`,
    schemaUid,
    permissionsHash,
    grantedAt,
    expiresAt,
    expirationTime,
  }
}

/**
 * Revoke a PublishAuthorization sidecar (must be signed by the original ManagedAccount attester).
 */
export async function revokePublishAuthorization(params: {
  wallet: PublishWallet | SeedTxSender
  uid: string
  schemaUid?: string
}): Promise<void> {
  const sender = resolveTxSender(params.wallet)
  const schemaUid = (params.schemaUid ?? getPublishAuthorizationSchemaUid()) as `0x${string}`
  const uid = normalizeBytes32Hex(params.uid) as `0x${string}`
  if (!isValidEasAttestationUid(uid)) {
    throw new Error(
      '@seedprotocol/publish: revokePublishAuthorization requires a valid attestation uid',
    )
  }

  const tx = prepareEasMultiRevoke([
    {
      schema: schemaUid,
      data: [{ uid }],
    },
  ])
  const receipt = await sendAndWait(sender, tx)
  if (!receipt) {
    throw new Error('@seedprotocol/publish: revokePublishAuthorization failed — no receipt')
  }
}

export type AssessPublishAuthorizationLiveResult = {
  uid: string
  decoded: PublishAuthorizationDecoded
  assess: PublishAuthorizationAssessResult
  expirationTime?: number | null
}

/**
 * Load a PublishAuthorization attestation by uid (via identity filter + client match) and assess.
 * Prefer filtering with {@link getPublishAuthorizationFromEas} when you know identity/sessionKey.
 */
export async function assessPublishAuthorizationLive(params: {
  uid: string
  identities: string[]
}): Promise<AssessPublishAuthorizationLiveResult | null> {
  const rows = await getPublishAuthorizationFromEas({
    identities: params.identities,
    excludeRevoked: false,
  })
  const row = rows.find((r) => r.id?.toLowerCase() === params.uid.toLowerCase())
  if (!row) return null
  const decoded = decodePublishAuthorizationData(row.decodedDataJson ?? '[]')
  const expirationTime =
    typeof row.expirationTime === 'number'
      ? row.expirationTime
      : typeof row.expirationTime === 'string'
        ? Number(row.expirationTime)
        : null
  return {
    uid: row.id,
    decoded,
    assess: assessPublishAuthorization({ decoded, expirationTime }),
    expirationTime,
  }
}
