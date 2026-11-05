import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import {
  PATH_MANIFEST_CONTENT_TYPE,
  buildPathManifest,
  exportArchive,
  readBagInfo,
  verifyArchive,
  type ArchiveSeedRef,
  type Bag,
  type ExportableItem,
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
  getContentSha256,
  type PublishUploadData,
  type TransactionTag,
} from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { ArchiveAnchorInterruptedError, ArchiveAnchorSchemaNotRegisteredError, type ArchiveAnchorResume } from '~/errors'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getAttestedUidsFromReceipt, prepareEasAttest, ZERO_ADDRESS } from '~/helpers/easDirect'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import { dataItemSignerForPublish, getPublishWallet } from '~/helpers/publishWalletRegistry'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { isPublishWallet, isSeedTxSender, type PublishWallet, type SeedTxSender } from '~/helpers/seedSigner'
import { directEasProblem } from '../publish/helpers/undeployedSmartAccount'
import { verifyArweaveTransactionsExist } from '../publish/helpers/verifyArweaveTransactionsExist'
import { directEasRefusal, resolveAttestationStrategy } from '../publish/actors/checking'
import { resolveMultiPublishSender } from '../publish/actors/createAttestations'
import { arweaveBlobStore } from '~/blobStore/arweave'
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
  /** Signs the uploads. Default the publish config's, else the wallet's, as a publish does. */
  dataItemSigner?: PublishMachineContext['dataItemSigner']
  signDataItems?: PublishMachineContext['signDataItems']
  publishAuthorization?: PublishMachineContext['publishAuthorization']
  /** `resume` from an {@link ArchiveAnchorInterruptedError}, so a retry doesn't pay for those uploads again. */
  resumeFrom?: ArchiveAnchorResume
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

/**
 * Signs and uploads `uploads` to Arweave, returning their transaction ids in order. They may not be
 * readable yet. Always Arweave, whatever `blobStore` says: the path manifest names Arweave ids.
 */
async function uploadAll(
  uploads: PublishUploadData[],
  options: AnchorArchiveOptions,
  attester: string,
): Promise<string[]> {
  if (uploads.length === 0) return []
  const config = getPublishConfig()
  const ctx = {
    signDataItems: options.signDataItems ?? config.signDataItems,
    // As a publish does: the caller's signer, else the config's, else the wallet's
    dataItemSigner:
      options.dataItemSigner ??
      config.dataItemSigner ??
      dataItemSignerForPublish(options.wallet ?? getPublishWallet(), attester),
    publishAuthorization: options.publishAuthorization,
  }
  const prepared = await arweaveBlobStore.prepare(uploads, ctx)
  if (prepared.pending) await arweaveBlobStore.send(prepared.pending, ctx)
  return prepared.ids
}

const transactionExists = (id: string): Promise<boolean> =>
  verifyArweaveTransactionsExist([id]).then(
    () => true,
    () => false,
  )

/** What can be reused from `resume` for this bag: the same bag, and transactions that exist. */
async function reusableUploads(bag: Bag, resume: ArchiveAnchorResume | undefined, tagmanifestSha256: string): Promise<ArchiveAnchorResume> {
  const none = { tagmanifestSha256, transactions: {} }
  if (resume?.tagmanifestSha256 !== tagmanifestSha256) return none
  const paths = new Set(bag.files.map((file) => file.path))
  const held = await Promise.all(
    Object.entries(resume.transactions)
      .filter(([path]) => paths.has(path))
      .map(async ([path, id]) => ((await transactionExists(id)) ? [[path, id] as const] : [])),
  )
  const manifestTx = resume.manifestTx && (await transactionExists(resume.manifestTx)) ? resume.manifestTx : undefined
  return { tagmanifestSha256, transactions: Object.fromEntries(held.flat()), manifestTx }
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

/** What an anchor of `bag` records, read from its bag-info.txt and tag manifest. */
function bagAnchorFields(bag: Bag) {
  const info = readBagInfo(bag)
  return {
    seedUid: info.get('Seed-Uid')!,
    versionUid: info.get('Seed-Version-Uid')!,
    attester: info.get('EAS-Attester') as `0x${string}`,
    coveredUntil: Date.parse(info.get('Seed-Bag-As-Of')!) / 1000,
    tagmanifestSha256: verifyArchive(bag).tagmanifestSha256!,
  }
}

/** The attester's anchor of this same bag, if EAS has one. */
async function existingAnchor(bag: Bag) {
  const { versionUid, attester, coveredUntil, tagmanifestSha256 } = bagAnchorFields(bag)
  return (await getArchiveAnchorsFromEas({ versionUid, attester })).find(
    (a) => a.coveredUntil === coveredUntil && a.tagmanifestSha256 === tagmanifestSha256,
  )
}

/**
 * Puts a reproducible bag of `item` on Arweave as a path manifest and attests it on the Version
 * (ADR 0029). Separate from publish, which never depends on it. Safe to repeat: the same bag with an
 * anchor from the attester returns that anchor. A failure after an upload throws
 * {@link ArchiveAnchorInterruptedError}; pass its `resume` as `resumeFrom` so the retry reuses them.
 *
 * Throws `ArchiveExportError`, whose `not_synced` means retry once the indexer has the Version, and
 * {@link ArchiveAnchorSchemaNotRegisteredError} before uploading anything when the schema is missing.
 *
 * The attestation isn't journaled as a publish's is: no attempt row and no pinned nonce. A receipt
 * lost after the send throws, and a retry before the indexer shows that anchor sends a second one.
 * That is accepted: both anchors name the same bag, readers treat them as equivalent (ADR 0029),
 * and the second costs one attestation.
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
  const { seedUid, versionUid, attester, coveredUntil, tagmanifestSha256 } = bagAnchorFields(bag)
  const existing = await existingAnchor(bag)
  if (existing) {
    return { uid: existing.uid, coveredUntil, manifestTx: existing.manifestTx, tagmanifestSha256, alreadyAnchored: true }
  }
  if (!(await getSchemaRecord(ARCHIVE_ANCHOR_SCHEMA_UID))) throw new ArchiveAnchorSchemaNotRegisteredError()

  const policy = options.tagPolicy ?? 'discoverable'
  const progress = await reusableUploads(bag, options.resumeFrom, tagmanifestSha256)
  try {
    const files = filesToUpload(bag, { ...arweaveTransactions, ...progress.transactions })
    if (files.length > 0) {
      // New files mean a new manifest.
      progress.manifestTx = undefined
      const ids = await uploadAll(files.map((f) => uploadData(f, versionUid, policy)), options, attester)
      files.forEach((file, i) => (progress.transactions[file.path] = ids[i]!))
      await verifyArweaveTransactionsExist(ids)
    }
    if (!progress.manifestTx) {
      const { bytes } = buildPathManifest(bag, { ...arweaveTransactions, ...progress.transactions })
      const manifest = { path: 'manifest', bytes, contentType: PATH_MANIFEST_CONTENT_TYPE, part: 'manifest' }
      ;[progress.manifestTx] = await uploadAll([uploadData(manifest, versionUid, policy)], options, attester)
      await verifyArweaveTransactionsExist([progress.manifestTx!])
    }
    const manifestTx = progress.manifestTx!
    const data = encodeArchiveAnchorData({ coveredUntil, manifestTx, tagmanifestSha256 })
    const uid = await attestAnchor({ seedUid, versionUid, attester, data }, options.wallet)
    return { uid, coveredUntil, manifestTx, tagmanifestSha256, alreadyAnchored: false }
  } catch (error) {
    if (Object.keys(progress.transactions).length === 0 && !progress.manifestTx) throw error
    throw new ArchiveAnchorInterruptedError(progress, error)
  }
}

/** {@link estimateArchiveAnchorCost}'s answer. */
export type ArchiveAnchorCostEstimate = PublishCostEstimate & {
  /** The attester already anchored this bag, so `anchorArchive` would send nothing: every cost is 0. */
  alreadyAnchored: boolean
}

/**
 * What an anchor of this bag would cost: its uploads, in the two bundles `anchorArchive` sends (the
 * files, then the path manifest), each charged Arweave's minimum, with the tags `tagPolicy` adds,
 * and one attestation. Nothing for a bag the attester already anchored.
 */
export async function estimateArchiveAnchorCost(
  item: ExportableItem | ArchiveSeedRef,
  options: ArchivePackageOptions & Pick<EstimatePublishCostOptions, 'rates'> = {},
): Promise<ArchiveAnchorCostEstimate> {
  const { bag, arweaveTransactions } = await exportArchive(item, {
    reproducible: true,
    asOf: options.asOf,
    expectedAttestations: options.expectedAttestations,
  })
  const work: PublishWorkSummary = {
    publishMode: 'patch',
    seedCount: 0,
    newSeedCount: 0,
    newVersionCount: 0,
    attestationCount: 0,
    uploadCount: 0,
    uploadBytes: 0,
    uploadSizes: [],
  }
  if (await existingAnchor(bag)) {
    const base = await estimatePublishCost(item as never, { work, rates: options.rates })
    const zero = (0).toPrecision(6)
    return {
      ...base,
      totalUsd: 0,
      evm: { ...base.evm, gas: 0n, eth: zero, usd: 0 },
      arweave: { ...base.arweave, chargedBytes: 0, ar: zero, usd: 0 },
      alreadyAnchored: true,
    }
  }

  const files = filesToUpload(bag, arweaveTransactions)
  // Only the size matters here, and a manifest's ids are all the same length.
  const placeholders = Object.fromEntries(bag.files.map((file) => [file.path, 'A'.repeat(43)]))
  const manifestBytes = buildPathManifest(bag, placeholders).bytes.byteLength
  const uploadSizes = [...files.map((f) => f.bytes.byteLength), manifestBytes]
  Object.assign(work, {
    attestationCount: 1,
    uploadCount: uploadSizes.length,
    uploadBytes: uploadSizes.reduce((a, b) => a + b, 0),
    uploadSizes,
  })
  const { versionUid } = bagAnchorFields(bag)
  // The longest Archive-Part value, as sizing uses the longest Content-Type.
  const uploadTags: TransactionTag[] =
    (options.tagPolicy ?? 'discoverable') === 'discoverable'
      ? [
          { name: 'Archive-Part', value: 'manifest' },
          { name: 'Seed-Version-Uid', value: versionUid },
          ...(getPublishConfig().arweaveUploadTags ?? []),
        ]
      : []
  const uploadBatches = files.length > 0 ? [files.length, 1] : [1]
  const estimate = await estimatePublishCost(item as never, { work, rates: options.rates, uploadTags, uploadBatches })
  return { ...estimate, alreadyAnchored: false }
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
