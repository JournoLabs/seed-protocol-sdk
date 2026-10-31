import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import {
  PATH_MANIFEST_CONTENT_TYPE,
  buildPathManifest,
  readBagInfo,
  verifyArchive,
  type Bag,
} from '@seedprotocol/archive'
import {
  ARCHIVE_ANCHOR_SCHEMA_DEF,
  ARCHIVE_ANCHOR_SCHEMA_NAME,
  ARCHIVE_ANCHOR_SCHEMA_UID,
  VERSION_SCHEMA_UID,
  arweaveTxIdToBytes32,
  getArchiveAnchorsFromEas,
} from '@seedprotocol/eas'
import {
  buildArweaveContentTags,
  exportArchive,
  getContentSha256,
  type ArchiveSeedRef,
  type ExportableItem,
  type PublishUploadData,
  type TransactionTag,
} from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { ArchiveAnchorSchemaNotRegisteredError } from '~/errors'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getAttestedUidsFromReceipt, prepareEasAttest, ZERO_ADDRESS } from '~/helpers/easDirect'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { isPublishWallet, isSeedTxSender, type PublishWallet, type SeedTxSender } from '~/helpers/seedSigner'
import { directEasProblem } from '../publish/helpers/undeployedSmartAccount'
import { verifyArweaveTransactionsExist } from '../publish/helpers/verifyArweaveTransactionsExist'
import { directEasRefusal, resolveAttestationStrategy } from '../publish/actors/checking'
import { signBundlerUploadDataList } from '../publish/actors/createArweaveDataItems'
import { resolveMultiPublishSender } from '../publish/actors/createAttestations'
import { uploadSignedDataItems } from '../publish/actors/uploadViaBundler'
import { estimatePublishCost } from '../publishCost/estimatePublishCost'
import type { EstimatePublishCostOptions, PublishCostEstimate, PublishWorkSummary } from '../publishCost/types'
import type { PublishMachineContext } from '../../types'

export { ARCHIVE_ANCHOR_SCHEMA_DEF, ARCHIVE_ANCHOR_SCHEMA_NAME, ARCHIVE_ANCHOR_SCHEMA_UID }

/**
 * What the package's uploads say about themselves. `discoverable`: `Archive-Part`,
 * `Seed-Version-Uid` and the configured `arweaveUploadTags`, so a query finds the parts of a
 * package. `hash-only`: Content-SHA-256 and Content-Type alone. Tags can't be removed later.
 */
export type ArchiveTagPolicy = 'discoverable' | 'hash-only'

export type ArchivePackageOptions = {
  /** The bag's time, unix seconds. Default as in `exportArchive`. */
  asOf?: number
  /** Default `discoverable`. */
  tagPolicy?: ArchiveTagPolicy
  /** Attestation uids the bag has to wait for, such as a publish's. See `exportArchive`. */
  expectedAttestations?: readonly string[]
}

export type AnchorArchiveOptions = ArchivePackageOptions & {
  /** Sends the attestation, as the Version's attester. Default the registered wallet. */
  wallet?: PublishWallet
  /** Signs the uploads. Default the publish config's. */
  dataItemSigner?: PublishMachineContext['dataItemSigner']
  signDataItems?: PublishMachineContext['signDataItems']
  publishAuthorization?: PublishMachineContext['publishAuthorization']
}

export type AnchorArchiveResult = {
  /** The anchor attestation. */
  uid: string
  coveredUntil: number
  manifestTx: string
  tagmanifestSha256: string
  /** An anchor for this bag already existed, so nothing was uploaded or sent. */
  alreadyAnchored: boolean
}

type PackageUpload = { path: string; bytes: Uint8Array; contentType: string; part: string }

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html',
  json: 'application/json',
  txt: 'text/plain',
  xml: 'application/xml',
}

const contentTypeOf = (path: string): string =>
  CONTENT_TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream'

const partOf = (path: string): string =>
  path === 'data/index.html' ? 'index' : path.startsWith('data/') ? 'asset' : 'tagfile'

/** The bag's files no published transaction holds. */
const filesToUpload = (bag: Bag, published: Record<string, string>): PackageUpload[] =>
  bag.files
    .filter((file) => !published[file.path])
    .map((file) => ({ ...file, contentType: contentTypeOf(file.path), part: partOf(file.path) }))

function uploadData(upload: PackageUpload, versionUid: string, policy: ArchiveTagPolicy): PublishUploadData {
  const contentHash = getContentSha256(upload.bytes)
  const extra: TransactionTag[] =
    policy === 'discoverable'
      ? [
          { name: 'Archive-Part', value: upload.part },
          { name: 'Seed-Version-Uid', value: versionUid },
          ...(getPublishConfig().arweaveUploadTags ?? []),
        ]
      : []
  return {
    blob: new Blob([upload.bytes as BlobPart], { type: upload.contentType }),
    contentHash,
    contentType: upload.contentType,
    tags: buildArweaveContentTags(contentHash, upload.contentType, extra),
    itemPropertyName: upload.path,
    itemPropertyLocalId: '',
    seedLocalId: '',
    versionLocalId: '',
  }
}

/** Signs and uploads `uploads`, returning their transaction ids in order. */
async function uploadAll(uploads: PublishUploadData[], options: AnchorArchiveOptions): Promise<string[]> {
  if (uploads.length === 0) return []
  const config = getPublishConfig()
  const dataItemSigner = options.dataItemSigner ?? config.dataItemSigner
  const signed = await signBundlerUploadDataList(uploads, options.signDataItems ?? config.signDataItems, dataItemSigner)
  if (signed.signedDataItems) {
    await uploadSignedDataItems(signed.signedDataItems, { dataItemSigner, publishAuthorization: options.publishAuthorization })
  }
  const ids = signed.arweaveTransactions.map((t) => (t.transaction as { id: string }).id)
  await verifyArweaveTransactionsExist(ids)
  return ids
}

export function encodeArchiveAnchorData(anchor: {
  coveredUntil: number
  manifestTx: string
  tagmanifestSha256: string
}): `0x${string}` {
  return new SchemaEncoder(ARCHIVE_ANCHOR_SCHEMA_DEF).encodeData([
    { name: 'covered_until', value: BigInt(anchor.coveredUntil), type: 'uint64' },
    { name: 'manifest_tx', value: arweaveTxIdToBytes32(anchor.manifestTx), type: 'bytes32' },
    { name: 'tagmanifest_sha256', value: `0x${anchor.tagmanifestSha256}`, type: 'bytes32' },
  ]) as `0x${string}`
}

/** Sends the attestation by the route a publish from `attester` takes, and returns its uid. */
async function attestAnchor(
  anchor: { seedUid: string; versionUid: string; attester: `0x${string}`; data: `0x${string}` },
  wallet: PublishWallet | undefined,
): Promise<string> {
  const { seedUid, versionUid, attester, data } = anchor
  const attestation = {
    recipient: ZERO_ADDRESS as `0x${string}`,
    expirationTime: BigInt(NO_EXPIRATION),
    revocable: true,
    refUID: versionUid as `0x${string}`,
    data,
    value: 0n,
  }
  const strategy = await resolveAttestationStrategy(attester)
  let transactionHash: `0x${string}`
  if (strategy === 'directEas') {
    const active = resolvePublishWallet({ wallet })
    const refusal = getPublishConfig().useDirectEas ? null : directEasRefusal(directEasProblem(attester, active), attester, active)
    if (refusal) throw refusal
    ;({ transactionHash } = await active.txSender.sendTransaction(
      prepareEasAttest({ schema: ARCHIVE_ANCHOR_SCHEMA_UID, data: attestation }),
    ))
  } else {
    const { sendMultiPublish, attesterAddress } = await resolveMultiPublishSender({ address: attester, wallet })
    if (attesterAddress.toLowerCase() !== attester.toLowerCase()) {
      throw new Error(`This wallet attests as ${attesterAddress}; the Version's attester is ${attester}, and readers ignore anyone else's anchor`)
    }
    // Supplying the seed and Version adds neither; only this attestation is made.
    ;({ transactionHash } = await sendMultiPublish([
      {
        localId: versionUid,
        seedUid,
        seedSchemaUid: ZERO_BYTES32,
        versionUid,
        versionSchemaUid: VERSION_SCHEMA_UID,
        seedIsRevocable: true,
        listOfAttestations: [{ schema: ARCHIVE_ANCHOR_SCHEMA_UID, data: [attestation] }],
        propertiesToUpdate: [],
      },
    ], (send) => send()))
  }
  const receipt = await waitForPublishReceipt(transactionHash)
  const attested = receipt ? getAttestedUidsFromReceipt(receipt, getPublishConfig().easContractAddress, attester) : []
  const created = attested.find((a) => a.schemaUid.toLowerCase() === ARCHIVE_ANCHOR_SCHEMA_UID)
  if (!created) throw new Error(`Transaction ${transactionHash} made no anchor attestation`)
  return created.uid
}

/**
 * Puts a reproducible bag of `item` on Arweave as a path manifest and attests it on the Version
 * (ADR 0029). Separate from publish, which never depends on it. Safe to repeat: the same bag with an
 * anchor from the attester returns that anchor, and any failure leaves nothing a retry trips over,
 * though a retry after a failed attestation uploads the new files again.
 *
 * Throws `ArchiveExportError`, whose `not_synced` means retry once the indexer has the Version, and
 * {@link ArchiveAnchorSchemaNotRegisteredError} before uploading anything when the schema is missing.
 */
export async function anchorArchive(
  item: ExportableItem | ArchiveSeedRef,
  options: AnchorArchiveOptions = {},
): Promise<AnchorArchiveResult> {
  const { bag, arweaveTransactions } = await exportArchive(item, {
    reproducible: true,
    asOf: options.asOf,
    expectedAttestations: options.expectedAttestations,
  })
  const info = readBagInfo(bag)
  const seedUid = info.get('Seed-Uid')!
  const versionUid = info.get('Seed-Version-Uid')!
  const attester = info.get('EAS-Attester') as `0x${string}`
  const coveredUntil = Date.parse(info.get('Seed-Bag-As-Of')!) / 1000
  const tagmanifestSha256 = verifyArchive(bag).tagmanifestSha256!

  const existing = (await getArchiveAnchorsFromEas({ versionUid, attester })).find(
    (a) => a.coveredUntil === coveredUntil && a.tagmanifestSha256 === tagmanifestSha256,
  )
  if (existing) {
    return { uid: existing.uid, coveredUntil, manifestTx: existing.manifestTx, tagmanifestSha256, alreadyAnchored: true }
  }
  if (!(await getSchemaRecord(ARCHIVE_ANCHOR_SCHEMA_UID))) throw new ArchiveAnchorSchemaNotRegisteredError()

  const policy = options.tagPolicy ?? 'discoverable'
  const files = filesToUpload(bag, arweaveTransactions)
  const ids = await uploadAll(files.map((f) => uploadData(f, versionUid, policy)), options)
  const transactions = { ...arweaveTransactions, ...Object.fromEntries(files.map((f, i) => [f.path, ids[i]!])) }
  const { bytes } = buildPathManifest(bag, transactions)
  const manifest = { path: 'manifest', bytes, contentType: PATH_MANIFEST_CONTENT_TYPE, part: 'manifest' }
  const [manifestTx] = await uploadAll([uploadData(manifest, versionUid, policy)], options)

  const data = encodeArchiveAnchorData({ coveredUntil, manifestTx: manifestTx!, tagmanifestSha256 })
  const uid = await attestAnchor({ seedUid, versionUid, attester, data }, options.wallet)
  return { uid, coveredUntil, manifestTx: manifestTx!, tagmanifestSha256, alreadyAnchored: false }
}

/** What an anchor of this bag would cost: its uploads, and one attestation. */
export async function estimateArchiveAnchorCost(
  item: ExportableItem | ArchiveSeedRef,
  options: ArchivePackageOptions & Pick<EstimatePublishCostOptions, 'rates'> = {},
): Promise<PublishCostEstimate> {
  const { bag, arweaveTransactions } = await exportArchive(item, {
    reproducible: true,
    asOf: options.asOf,
    expectedAttestations: options.expectedAttestations,
  })
  const files = filesToUpload(bag, arweaveTransactions)
  // Only the size matters here, and a manifest's ids are all the same length.
  const placeholders = Object.fromEntries(bag.files.map((file) => [file.path, 'A'.repeat(43)]))
  const manifestBytes = buildPathManifest(bag, placeholders).bytes.byteLength
  const uploadSizes = [...files.map((f) => f.bytes.byteLength), manifestBytes]
  const work: PublishWorkSummary = {
    publishMode: 'patch',
    seedCount: 0,
    newSeedCount: 0,
    newVersionCount: 0,
    attestationCount: 1,
    uploadCount: uploadSizes.length,
    uploadBytes: uploadSizes.reduce((a, b) => a + b, 0),
    uploadSizes,
  }
  return estimatePublishCost(item as never, { work, rates: options.rates })
}

/**
 * Registers the anchor schema and names it, once per chain, if it's missing. Needs the owner
 * wallet: a session key can't call SchemaRegistry.
 */
export async function ensureArchiveAnchorSchema(account: PublishWallet | SeedTxSender): Promise<`0x${string}`> {
  const sender = isPublishWallet(account) ? account.txSender : account
  if (!isSeedTxSender(sender)) throw new Error('@seedprotocol/publish: ensureArchiveAnchorSchema requires a PublishWallet or SeedTxSender')
  const schemaUid = ARCHIVE_ANCHOR_SCHEMA_UID as `0x${string}`
  if (!(await getSchemaRecord(schemaUid))) {
    const send = async (tx: Parameters<SeedTxSender['sendTransaction']>[0]) =>
      waitForPublishReceipt((await sender.sendTransaction(tx)).transactionHash)
    await send(registerSchema({ schema: ARCHIVE_ANCHOR_SCHEMA_DEF, resolverAddress: ZERO_ADDRESS, revocable: true }))
    await send(prepareNameSchemaAttestation({ schemaUid, schemaName: ARCHIVE_ANCHOR_SCHEMA_NAME }))
  }
  return schemaUid
}
