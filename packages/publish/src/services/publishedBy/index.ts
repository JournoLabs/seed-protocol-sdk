import {
  PUBLISHED_BY_SCHEMA_DEF,
  PUBLISHED_BY_SCHEMA_NAME,
  hashPublishedByBatch,
  type PublishedByDecoded,
} from '@seedprotocol/eas'
import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { prepareEasAttest, prepareEasMultiRevoke, ZERO_ADDRESS } from '~/helpers/easDirect'
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

export {
  PUBLISHED_BY_SCHEMA_DEF,
  PUBLISHED_BY_SCHEMA_NAME,
  hashPublishedByBatch,
} from '@seedprotocol/eas'

const RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
const REVOCABLE = true

export type PublishedBatchResult = {
  seedUid: `0x${string}`
  versionUid?: `0x${string}`
  attestationUids: `0x${string}`[]
}

export type OnPublishedCallback = (
  result: PublishedBatchResult & { seedLocalId: string },
) => void | Promise<void>

export type AttestPublishedByUidsMode = {
  mode: 'uids'
  attestationUids: readonly string[]
  /** Optional override; defaults to hash of sorted attestationUids. */
  batchHash?: string
}

export type AttestPublishedByHashMode = {
  mode: 'hash'
  batchHash: string
  /** On-chain array is empty; keep the full list off-chain for verification. */
  attestationUids?: never
}

export type AttestPublishedByParams = {
  wallet: PublishWallet | SeedTxSender
  seedUid: string
  versionUid?: string
  toolName: string
  toolVersion: string
  /**
   * When true (default), register + name the PublishedBy schema if missing.
   */
  ensureSchema?: boolean
} & (AttestPublishedByUidsMode | AttestPublishedByHashMode)

export type AttestPublishedByResult = {
  uid: `0x${string}`
  schemaUid: `0x${string}`
  batchHash: `0x${string}`
  attestationUids: `0x${string}`[]
}

function resolveTxSender(account: PublishWallet | SeedTxSender): SeedTxSender {
  if (isPublishWallet(account)) return account.txSender
  if (isSeedTxSender(account)) return account
  throw new Error(
    '@seedprotocol/publish: attestPublishedBy / revokePublishedBy require a PublishWallet or SeedTxSender',
  )
}

async function sendAndWait(txSender: SeedTxSender, tx: Parameters<SeedTxSender['sendTransaction']>[0]) {
  const result = await txSender.sendTransaction(tx)
  return waitForPublishReceipt(result.transactionHash)
}

/** Deterministic on-chain schema UID for {@link PUBLISHED_BY_SCHEMA_DEF}. */
export function getPublishedBySchemaUid(): `0x${string}` {
  return SchemaRegistry.getSchemaUID(
    PUBLISHED_BY_SCHEMA_DEF,
    RESOLVER_ADDRESS as `0x${string}`,
    REVOCABLE,
  ) as `0x${string}`
}

/**
 * Registers the PublishedBy EAS schema (if missing) and creates a Schema #1 name attestation.
 */
export async function ensurePublishedBySchema(
  account: PublishWallet | SeedTxSender,
): Promise<`0x${string}`> {
  const sender = resolveTxSender(account)
  const schemaUid = getPublishedBySchemaUid()
  const onChain = await getSchemaRecord(schemaUid)
  if (!onChain) {
    await sendAndWait(
      sender,
      registerSchema({
        schema: PUBLISHED_BY_SCHEMA_DEF,
        resolverAddress: RESOLVER_ADDRESS,
        revocable: REVOCABLE,
      }),
    )
    await sendAndWait(
      sender,
      prepareNameSchemaAttestation({
        schemaUid,
        schemaName: PUBLISHED_BY_SCHEMA_NAME,
      }),
    )
  }
  return schemaUid
}

export function encodePublishedByAttestationData(params: {
  seedUid: string
  versionUid: string
  attestationUids: readonly string[]
  batchHash: string
  toolName: string
  toolVersion: string
}): `0x${string}` {
  const schemaEncoder = new SchemaEncoder(PUBLISHED_BY_SCHEMA_DEF)
  const encodedData = schemaEncoder.encodeData([
    { name: 'seedUid', value: normalizeBytes32Hex(params.seedUid) as `0x${string}`, type: 'bytes32' },
    {
      name: 'versionUid',
      value: normalizeBytes32Hex(params.versionUid || ZERO_BYTES32) as `0x${string}`,
      type: 'bytes32',
    },
    {
      name: 'attestationUids',
      value: params.attestationUids.map((u) => normalizeBytes32Hex(u) as `0x${string}`),
      type: 'bytes32[]',
    },
    {
      name: 'batchHash',
      value: normalizeBytes32Hex(params.batchHash) as `0x${string}`,
      type: 'bytes32',
    },
    { name: 'toolName', value: params.toolName, type: 'string' },
    { name: 'toolVersion', value: params.toolVersion, type: 'string' },
  ])
  return encodedData as `0x${string}`
}

/**
 * Tool wallet attests a PublishedBy sidecar for a publish batch.
 * - `mode: 'uids'`: on-chain UID list + batchHash of sorted UIDs
 * - `mode: 'hash'`: empty UID list + caller-supplied batchHash (full list kept off-chain)
 */
export async function attestPublishedBy(
  params: AttestPublishedByParams,
): Promise<AttestPublishedByResult> {
  const sender = resolveTxSender(params.wallet)
  const schemaUid =
    params.ensureSchema === false
      ? getPublishedBySchemaUid()
      : await ensurePublishedBySchema(params.wallet)

  let attestationUids: `0x${string}`[] = []
  let batchHash: `0x${string}`

  if (params.mode === 'uids') {
    attestationUids = params.attestationUids
      .map((u) => normalizeBytes32Hex(u) as `0x${string}`)
      .filter((u) => isValidEasAttestationUid(u))
    batchHash = (params.batchHash
      ? normalizeBytes32Hex(params.batchHash)
      : hashPublishedByBatch(attestationUids)) as `0x${string}`
  } else {
    if (!params.batchHash) {
      throw new Error('@seedprotocol/publish: attestPublishedBy hash mode requires batchHash')
    }
    batchHash = normalizeBytes32Hex(params.batchHash) as `0x${string}`
    if (batchHash === ZERO_BYTES32) {
      throw new Error('@seedprotocol/publish: attestPublishedBy hash mode requires a non-zero batchHash')
    }
  }

  const seedUid = normalizeBytes32Hex(params.seedUid) as `0x${string}`
  if (!isValidEasAttestationUid(seedUid)) {
    throw new Error('@seedprotocol/publish: attestPublishedBy requires a valid seedUid')
  }

  const versionUid = normalizeBytes32Hex(params.versionUid ?? ZERO_BYTES32) as `0x${string}`
  const data = encodePublishedByAttestationData({
    seedUid,
    versionUid,
    attestationUids,
    batchHash,
    toolName: params.toolName,
    toolVersion: params.toolVersion,
  })

  const tx = prepareEasAttest({
    schema: schemaUid,
    data: {
      recipient: ZERO_ADDRESS as `0x${string}`,
      expirationTime: BigInt(NO_EXPIRATION),
      revocable: true,
      refUID: seedUid,
      data,
      value: 0n,
    },
  })

  const receipt = await sendAndWait(sender, tx)
  if (!receipt) {
    throw new Error('@seedprotocol/publish: attestPublishedBy failed — no receipt')
  }
  const { easContractAddress } = getPublishConfig()
  const uid = getAttestationUidFromReceipt(receipt, easContractAddress)
  if (!uid || !isValidEasAttestationUid(uid)) {
    throw new Error('@seedprotocol/publish: attestPublishedBy failed — could not parse attestation UID')
  }

  return {
    uid: uid as `0x${string}`,
    schemaUid,
    batchHash,
    attestationUids,
  }
}

/**
 * Revoke a PublishedBy sidecar attestation (must be signed by the original tool attester).
 */
export async function revokePublishedBy(params: {
  wallet: PublishWallet | SeedTxSender
  uid: string
  schemaUid?: string
}): Promise<void> {
  const sender = resolveTxSender(params.wallet)
  const schemaUid = (params.schemaUid ?? getPublishedBySchemaUid()) as `0x${string}`
  const uid = normalizeBytes32Hex(params.uid) as `0x${string}`
  if (!isValidEasAttestationUid(uid)) {
    throw new Error('@seedprotocol/publish: revokePublishedBy requires a valid attestation uid')
  }

  const tx = prepareEasMultiRevoke([
    {
      schema: schemaUid,
      data: [{ uid }],
    },
  ])
  const receipt = await sendAndWait(sender, tx)
  if (!receipt) {
    throw new Error('@seedprotocol/publish: revokePublishedBy failed — no receipt')
  }
}

export type { PublishedByDecoded }

export { collectPublishedBatch, uidsFromAttestationPairs } from './collectBatchUids'
