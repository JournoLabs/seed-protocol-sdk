import {
  createBag,
  digestHex,
  dublinCoreXml,
  parseArchiveDocument,
  premisXml,
  rewriteHtmlUrls,
  verifyInstructions,
  type Bag,
  type BagFile,
  type BagInfoEntry,
  type PremisEvent,
  type PremisFile,
} from '@seedprotocol/archive'
import {
  fetchArweaveRawBytesAcrossGateways,
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '@seedprotocol/arweave'
import {
  getEasAttestationExplorerUrl,
  getEasChainDeployment,
  getEasReadChainId,
  isEasEmptyValue,
  isUnfilledReference,
  isValidEasAttestationUid,
  type Attestation,
} from '@seedprotocol/eas'
import { parseEasPropertyMetadata } from '@seedprotocol/query'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { findSeedRow } from '@/db/read/findSeedRow'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { getMetadata } from '@/db/read/getMetadata'
import { nameMatchLevels } from '@/db/read/nameMatchLevels'
import { getPublishGraph, modelOfSeed, publishPropertyKind, refsOf, type PublishGraphProperty, type PublishPropertyKind } from '@/db/read/publishGraph'
import { resolveItemStorageChildFile } from '@/db/read/getPublishUploads'
import { resolveModelRecordByNameOrType } from '@/db/read/resolveModelRecord'
import { findRelatedSeedRow, isLivePublishedSeed, isUnpublishedSeed } from '@/db/read/resolveRelatedSeedRef'
import { resolveSyncedPropertyName } from '@/events/item/syncDbWithEas'
import { decodeCompositeUpload, isCompositeUpload } from '@/helpers/compositeUpload'
import { syncedPropertyValue } from '@/helpers/easValueTypes'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { findEmbeddedImageFilePath, SEED_PROPERTY_REF_PREFIX } from '@/helpers/htmlEmbeddedDataUriPublish'
import { getExtensionForMimeType, resolveUploadMimeType } from '@/helpers/mimeTypes'
import { normalizeDataType } from '@/helpers/property'
import { getPropertyDefinitions, type PropertyDefinition } from '@/helpers/propertyDefinition'
import { isPublishedSeedRef } from '@/helpers/relationSeedRef'
import { versions } from '@/seedSchema'
import { resolveStorageDisplay, storageSeedTransactionId, storedValueKind, type StoredValueKind } from '@/storageValue/resolve'
import { readSeedAtTime, type SeedAtTime } from './seedAtTime'

/**
 * Exports a published item as a BagIt bag (RFC 8493) that an archive can ingest without Seed
 * code: its Html, its files and its attested values, with SHA-256/SHA-512 manifests, Dublin Core
 * and PREMIS metadata. See docs/ARCHIVE.md for the bag's layout.
 */

export type ExportArchiveOptions = {
  /**
   * Download Images, Files and Html bodies that aren't on this device. Default true. A reproducible
   * bag always reads them by transaction id, so `false` is refused with `reproducible`.
   */
  fetch?: boolean
  /**
   * Build the bag every client gets for this state of the seed, whatever this device holds: values,
   * times and the attester come from EAS, file bytes from their Arweave transactions, and nothing
   * local goes in. Needs the EAS indexer and a read gateway, and refuses a device that has attested
   * something EAS doesn't report yet, a bag that would leave anything out, and
   * `sourceOrganization` or `baggingDate`. Default false.
   */
  reproducible?: boolean
  /**
   * Reproducible only: the seed as it was at this time (unix seconds), so a later patch, Version or
   * revocation doesn't change the bag. Default: the last attestation or revocation on the newest
   * live Version's properties.
   */
  asOf?: number
  /** bag-info.txt Source-Organization, e.g. the publication. Left out when not given. */
  sourceOrganization?: string
  /** Bagging-Date and the time of the bag's own PREMIS events. Defaults to now. */
  baggingDate?: Date
}

/** Something the item has that the bag doesn't carry, and why. Also listed in data/item.json. */
export type ArchiveOmission = { property: string; reason: string }

export type ExportArchiveResult = {
  bag: Bag
  omitted: ArchiveOmission[]
  /**
   * With `reproducible`: bag path to the Arweave transaction that already holds exactly those bytes.
   * A path manifest points at these; the bag's other files need an upload.
   */
  arweaveTransactions: Record<string, string>
}

export type ArchiveExportErrorCode =
  | 'not_published'
  | 'unpublished_changes'
  /** reproducible: EAS doesn't report the seed, or everything this device has attested for it, yet. */
  | 'not_synced'
  /** reproducible: the EAS indexer couldn't be read. */
  | 'chain_unavailable'
  /** reproducible: the bag would leave something out. */
  | 'incomplete'
  /** Options that can't go together. */
  | 'invalid_options'

/** The item can't be exported as it is. `code` says why. */
export class ArchiveExportError extends Error {
  readonly code: ArchiveExportErrorCode

  constructor(code: ArchiveExportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ArchiveExportError'
    this.code = code
  }
}

/**
 * Whose clock a time in the bag came from:
 * - `chain-block`: the attestation's `timeCreated` as EAS reports it, the attesting chain's block time.
 * - `local-record`: the attestation time this device recorded. For a row synced from EAS that is the
 *   block time; for an attestation this device published, the block time when it could be read at
 *   publish, otherwise this device's clock. The two can't be told apart afterwards.
 * - `export-device`: this device's clock when it made the bag.
 */
export type ArchiveClockSource = 'chain-block' | 'local-record' | 'export-device'

export type ExportableItem = {
  seedLocalId: string
  modelName?: string
  getService?: () => { getSnapshot: () => { context: { schemaName?: string } } }
}

/**
 * A seed named by its uid, for a reproducible bag on a device that holds no rows for it. Only the
 * schema has to be loaded.
 */
export type ArchiveSeedRef = { seedUid: string; modelName: string; schemaName?: string }

/** A property value as data/item.json records it. */
type ItemJsonProperty = {
  dataType: string
  value?: string | string[] | null
  file?: string
  arweaveTransactionId?: string
  attestationUid?: string
  attestedAt?: string
  attestedAtClock?: ArchiveClockSource
}

type Stamp = { iso: string; clock: ArchiveClockSource }

/** A property's value and file, from this device's rows or from EAS. */
type ArchiveProperty = {
  key: string
  definition: PropertyDefinition
  kind: PublishPropertyKind
  value?: string | null
  attestationUid?: string
  /** The attestation time this device recorded; local bags only. */
  recordedMs?: number | null
  refSeedType?: string | null
}

type ArchiveFile = { bytes?: Uint8Array; fileName?: string; arweaveTransactionId?: string }

/** Where one export reads from: the two differ in nothing but this. */
type ArchiveSource = {
  seedUid: string
  versionUid: string
  versionMs?: number | null
  modelName: string
  attester?: string
  properties: ArchiveProperty[]
  /** Reproducible bags only. */
  chain?: SeedAtTime
  /** The ItemStorage file; `missing` when it should exist and couldn't be read. */
  readItemStorage: (property: ArchiveProperty) => Promise<ArchiveFile | 'missing' | undefined>
  readStorageSeed: (property: ArchiveProperty, kind: StoredValueKind) => Promise<ArchiveFile>
  /** An image the Html names by transaction id and no property holds. */
  readEmbeddedImage: (txId: string) => Promise<ArchiveFile | undefined>
  history: (chainId: number) => Promise<PremisEvent[]>
}

const ARWEAVE_TX_ID = /^[a-z0-9_-]{43}$/i
const SOFTWARE_AGENT = '@seedprotocol/sdk exportArchive (https://github.com/JournoLabs/seed-protocol-sdk)'
/** Raise it when a change would alter a reproducible bag's bytes (ADR 0028). */
const REPRODUCIBLE_BAG_FORMAT = '1'

const isoFromMs = (ms: number | null | undefined): string | undefined =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined

const isoFromSeconds = (seconds: number): string => new Date(seconds * 1000).toISOString()

const describeClock = (clock: ArchiveClockSource, chainId: number): string =>
  clock === 'chain-block'
    ? `EAS timeCreated, the block time on chain ${chainId}`
    : clock === 'local-record'
      ? 'attestation time recorded on the exporting device (block time, or that device’s clock when the block could not be read)'
      : 'clock of the exporting device'

const sameUid = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

const toBytes = async (data: Buffer | Blob): Promise<Uint8Array> =>
  typeof Blob !== 'undefined' && data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data as Buffer)

const readBytes = async (filePath: string): Promise<Uint8Array> => toBytes(await BaseFileManager.readFileAsBuffer(filePath))

/** The Arweave transaction id a gateway URL serves (`https://<host>/<tx>` or `/raw/<tx>`), if it is one. */
function arweaveTxIdOfUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    const segments = parsed.pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    const isTxPath = segments.length === 1 || (segments.length === 2 && segments[0] === 'raw')
    return isTxPath && last && ARWEAVE_TX_ID.test(last) ? last : undefined
  } catch {
    return undefined
  }
}

const hasValue = (value: string | null | undefined): boolean => value != null && value !== ''

/** A saved local value that no attestation backs: the bag would mix it with the published record. */
const isUnpublishedEdit = (property: PublishGraphProperty): boolean => {
  const row = property.row
  return !!row && !property.deferred && !row.uid && row.derivedFromUid == null && hasValue(row.propertyValue)
}

const propertyUid = (property: PublishGraphProperty): string | undefined =>
  property.row?.uid ?? property.row?.derivedFromUid ?? undefined

/**
 * A relation ref as the chain holds it. The device that published keeps local ids in its rows and a
 * client that synced holds uids, so a local id becomes its seed's uid, revoked or not: that uid is
 * what was attested. Stays a local id only when the seed never got one.
 */
async function attestedRef(ref: string): Promise<string> {
  if (isPublishedSeedRef(ref)) return ref
  const seed = await findRelatedSeedRow(resolveSeedIdsFromRefString(ref))
  return isLivePublishedSeed(seed) || isUnpublishedSeed(seed) ? seed.seedUid : ref
}

/** The bag's source on this device: its rows and files, refused while it holds unpublished edits. */
async function localSource(item: ExportableItem, fetch: boolean): Promise<ArchiveSource> {
  const graph = await getPublishGraph(item)
  const root = graph.root
  const seedRow = await findSeedRow({ localId: root.seedLocalId })
  const seedUid = root.seedUid
  const version = await getLatestPublishedVersionRow(root.seedLocalId)
  if (!seedUid || !isValidEasAttestationUid(seedUid) || seedRow?.revokedAt || !version) {
    throw new ArchiveExportError('not_published', `${root.modelName} ${root.seedLocalId} has no live published version`)
  }
  const unpublished = root.properties.filter(isUnpublishedEdit).map((p) => p.key)
  if (unpublished.length > 0) {
    throw new ArchiveExportError(
      'unpublished_changes',
      `${root.modelName} ${root.seedLocalId} has unpublished changes to ${unpublished.join(', ')}; publish them first`,
    )
  }

  const graphProperty = new Map(root.properties.map((p) => [p.key, p]))
  return {
    seedUid,
    versionUid: version.uid,
    versionMs: version.attestationCreatedAt,
    modelName: root.modelName,
    attester: seedRow?.publisher ?? undefined,
    properties: root.properties.map((property) => ({
      key: property.key,
      definition: property.definition,
      kind: property.kind,
      value: property.row?.propertyValue,
      attestationUid: propertyUid(property),
      recordedMs: property.row?.attestationCreatedAt,
      refSeedType: property.row?.refSeedType,
    })),
    readItemStorage: async (property) => {
      const { filePath } = await resolveItemStorageChildFile(root, graphProperty.get(property.key)!)
      if (filePath) return { bytes: await readBytes(filePath), fileName: filePath }
      return hasValue(property.value) ? 'missing' : undefined
    },
    readStorageSeed: async (property, kind) => {
      const row = graphProperty.get(property.key)!.row!
      const arweaveTransactionId = await storageSeedTransactionId(
        resolveSeedIdsFromRefString(normalizeRelationPropertyValue(row.propertyValue) ?? ''),
      )
      // The bag keeps each Html exactly as published
      const display = await resolveStorageDisplay(kind, row, { fetch, rehostLinks: false })
      if (display.filePath) {
        return { bytes: await readBytes(display.filePath), fileName: display.filePath, arweaveTransactionId }
      }
      const text = kind === 'html' ? display.renderValue : undefined
      return { bytes: text === undefined ? undefined : new TextEncoder().encode(text), arweaveTransactionId }
    },
    readEmbeddedImage: async (txId) => {
      const imageRow = await getMetadata({ storageTransactionId: txId })
      let filePath = imageRow?.seedLocalId ? await findEmbeddedImageFilePath(imageRow.seedLocalId) : undefined
      if (!filePath) {
        const display = await resolveStorageDisplay('image', { refResolvedValue: txId, localStorageDir: '/images' }, { fetch })
        filePath = display.filePath
      }
      return filePath ? { bytes: await readBytes(filePath), fileName: filePath, arweaveTransactionId: txId } : undefined
    },
    history: (chainId) =>
      localHistoryEvents(root.seedLocalId, seedUid, root.properties, version, seedRow?.publisher ?? undefined, chainId),
  }
}

const readSeedFromChain = async (seedUid: string, asOf?: number): Promise<SeedAtTime | undefined> => {
  try {
    return await readSeedAtTime(seedUid, asOf)
  } catch (error) {
    throw new ArchiveExportError('chain_unavailable', `Couldn't read seed ${seedUid} from EAS`, { cause: error })
  }
}

/** A property attestation's value as a synced row holds it; undefined when it doesn't decode. */
function attestedValue(
  metadata: { type?: string; value?: unknown },
  dataType: string | undefined,
  isRelation: boolean,
  retracted: boolean,
): string | null | undefined {
  const value = Array.isArray(metadata.value) ? metadata.value.filter((v) => !isUnfilledReference(v)) : metadata.value
  if (retracted || isEasEmptyValue(metadata.type, value)) return null
  if (isRelation && !Array.isArray(value) && isUnfilledReference(value)) return undefined
  const decoded = syncedPropertyValue(dataType, metadata.type, value)
  if (decoded === undefined || decoded === null) return decoded
  return typeof decoded === 'string' ? decoded : JSON.stringify(decoded)
}

/** The Arweave transaction a storage seed held at `asOf`. */
async function chainStorageTransaction(seedUid: string, asOf: number): Promise<string | undefined> {
  const state = await readSeedFromChain(seedUid, asOf)
  for (const attestation of state?.properties ?? []) {
    const parsed = parseEasPropertyMetadata(attestation.decodedDataJson)
    if (!parsed.ok || attestation.revoked) continue
    const { name, value } = parsed.metadata
    const isSlot = name === 'storage_transaction_id' || name === 'transaction_id'
    if (isSlot && typeof value === 'string' && ARWEAVE_TX_ID.test(value)) return value
  }
  return undefined
}

/**
 * Refuses when this device has attested something EAS doesn't report: the indexer is behind, and
 * the bag would be of an older state without saying so.
 */
async function assertChainHasLocalState(item: ExportableItem, state: SeedAtTime): Promise<void> {
  const { root } = await getPublishGraph(item)
  const local = await getLatestPublishedVersionRow(root.seedLocalId)
  if (local && !state.versions.some((v) => sameUid(v.id, local.uid))) {
    throw new ArchiveExportError('not_synced', `EAS doesn't report Version ${local.uid} yet`)
  }
  const reported = new Set(state.allProperties.map((p) => p.id.toLowerCase()))
  const missing = root.properties
    .filter((p) => sameUid(p.row?.versionUid, state.version!.id))
    .map(propertyUid)
    .filter((uid): uid is string => isValidEasAttestationUid(uid) && !reported.has(uid!.toLowerCase()))
  if (missing.length > 0) {
    throw new ArchiveExportError('not_synced', `EAS doesn't report property attestations ${missing.join(', ')} yet`)
  }
}

/** The bag's source on EAS and Arweave. Uses this device for nothing but the schema. */
async function chainSource(item: ExportableItem | ArchiveSeedRef, asOf: number | undefined): Promise<ArchiveSource> {
  const localItem = 'seedLocalId' in item && item.seedLocalId ? (item as ExportableItem) : undefined
  const seedRow = localItem ? await findSeedRow({ localId: localItem.seedLocalId }) : undefined
  const seedUid = localItem ? seedRow?.uid : (item as ArchiveSeedRef).seedUid
  if (!seedUid || !isValidEasAttestationUid(seedUid)) {
    throw new ArchiveExportError('not_published', `${item.modelName} ${localItem?.seedLocalId ?? seedUid} has no seed attestation`)
  }
  const model = seedRow
    ? await modelOfSeed(seedRow, item.modelName)
    : await resolveModelRecordByNameOrType(item.modelName, { schemaName: (item as ArchiveSeedRef).schemaName })
  if (!model) throw new ArchiveExportError('invalid_options', `Model ${item.modelName} isn't loaded; load its schema first`)

  const state = await readSeedFromChain(seedUid, asOf)
  if (!state) throw new ArchiveExportError('not_synced', `EAS has no seed attestation ${seedUid}`)
  const version = state.version
  const seedRevoked = state.seed.revoked && (asOf === undefined || state.seed.revocationTime <= asOf)
  if (!version || seedRevoked) {
    throw new ArchiveExportError('not_published', `${model.name} ${seedUid} has no live Version${asOf ? ` at ${asOf}` : ''}`)
  }
  if (localItem && asOf === undefined) await assertChainHasLocalState(localItem, state)

  const definitions = await getPropertyDefinitions(model.id)
  const levels = await nameMatchLevels()
  const schema = Object.fromEntries(
    [...definitions].map(([key, def]) => [key, { ...def, nameMatch: levels.property(model.name, key, model.schemaFileId ?? undefined) }]),
  )
  const attested = new Map<string, { attestation: Attestation; value: string | null }>()
  let storageTransaction: { attestation: Attestation; id: string } | undefined
  // Oldest first: where two schemas stand for one property, the newer one holds it.
  for (const attestation of [...state.properties].sort((a, b) => a.timeCreated - b.timeCreated)) {
    const parsed = parseEasPropertyMetadata(attestation.decodedDataJson)
    if (!parsed.ok || !parsed.metadata.name) continue
    const { name, value: raw, type } = parsed.metadata
    if (name === 'storage_transaction_id' && typeof raw === 'string') storageTransaction = { attestation, id: raw }
    const resolved = resolveSyncedPropertyName(name, raw, schema, type)
    const key = resolved?.key ?? resolved?.propertyName
    if (!resolved || !key || !definitions.has(key)) continue
    const value = attestedValue(parsed.metadata, resolved.dataType, resolved.isRelation, attestation.revoked)
    if (value !== undefined) attested.set(key, { attestation, value })
  }

  const downloads = new Map<string, Promise<Uint8Array | undefined>>()
  const readTransaction = (txId: string): Promise<Uint8Array | undefined> => {
    const download = downloads.get(txId) ?? fetchArweaveRawBytesAcrossGateways(txId)
    downloads.set(txId, download)
    return download
  }

  return {
    seedUid,
    versionUid: version.id,
    modelName: model.name,
    attester: state.seed.attester,
    chain: state,
    properties: [...definitions].map(([key, definition]) => {
      const kind = publishPropertyKind(key, definition)
      const held = kind === 'itemStorage' ? storageTransaction?.attestation : attested.get(key)?.attestation
      return { key, definition, kind, value: attested.get(key)?.value, attestationUid: held?.id }
    }),
    readItemStorage: async (property) => {
      if (!storageTransaction || storageTransaction.attestation.revoked) return undefined
      const bytes = await readTransaction(storageTransaction.id)
      if (!bytes) return 'missing'
      if (!isCompositeUpload(bytes)) return { bytes }
      const child = decodeCompositeUpload(bytes)?.find((c) => c.name === property.key)
      return child ? { bytes: child.bytes } : undefined
    },
    readStorageSeed: async (property) => {
      const uid = normalizeRelationPropertyValue(property.value)
      const arweaveTransactionId = uid ? await chainStorageTransaction(uid, state.asOf) : undefined
      return { bytes: arweaveTransactionId ? await readTransaction(arweaveTransactionId) : undefined, arweaveTransactionId }
    },
    readEmbeddedImage: async (txId) => {
      const bytes = await readTransaction(txId)
      return bytes ? { bytes, arweaveTransactionId: txId } : undefined
    },
    history: async (chainId) => chainHistoryEvents(state, chainId),
  }
}

/**
 * Builds the bag for `item`'s published state:
 *
 * - `data/index.html` (or `data/<property>.html` when the model has several Html properties): the
 *   Html with references to files in the bag rewritten to relative paths.
 * - `data/source/<property>.html`: each Html exactly as published, byte for byte.
 * - `data/assets/<sha256>.<ext>`: Images, Files and images the Html references.
 * - `data/item.json`: every property's value, attestation uid and Arweave transaction.
 * - `metadata/dc.xml` and `metadata/premis.xml`.
 *
 * Every time in the bag says whose clock it came from ({@link ArchiveClockSource}). With
 * `reproducible`, the bag is a function of EAS, Arweave and the schema (ADR 0028), so every client
 * gets the same bytes and the same tagmanifest hash, and `item` can be an {@link ArchiveSeedRef}.
 *
 * Throws {@link ArchiveExportError} `not_published` for an item without a live published version,
 * and, except with `reproducible`, `unpublished_changes` when a property holds a saved value that
 * isn't published yet. A file that can't be read or downloaded is left out and reported in
 * `omitted`, not thrown, except with `reproducible`.
 */
export async function exportArchive(
  item: ExportableItem | ArchiveSeedRef,
  options: ExportArchiveOptions = {},
): Promise<ExportArchiveResult> {
  const fetch = options.fetch ?? true
  const reproducible = options.reproducible ?? false
  const { asOf } = options
  if (reproducible && (options.sourceOrganization !== undefined || options.baggingDate !== undefined || !fetch)) {
    throw new ArchiveExportError(
      'invalid_options',
      'A reproducible bag takes no sourceOrganization or baggingDate, which would differ between clients, and reads its files from Arweave, so it refuses fetch: false',
    )
  }
  if (asOf !== undefined && (!reproducible || !Number.isSafeInteger(asOf) || asOf <= 0)) {
    throw new ArchiveExportError('invalid_options', 'asOf is unix seconds, and needs reproducible: rows only hold the latest state')
  }
  if (!reproducible && !('seedLocalId' in item && item.seedLocalId)) {
    throw new ArchiveExportError('invalid_options', 'A seed named by uid can only be exported with reproducible')
  }
  const source = reproducible
    ? await chainSource(item, asOf)
    : await localSource(item as ExportableItem, fetch)
  const { seedUid, versionUid, modelName, attester, chain: chainRecord } = source

  const chainTimeByUid = new Map<string, number>(
    chainRecord
      ? [chainRecord.seed, ...chainRecord.versions, ...chainRecord.properties].map((a) => [a.id.toLowerCase(), a.timeCreated])
      : [],
  )
  /** The time an attestation was made: from EAS when reproducible, else from the local row. */
  const stampOf = (uid: string | undefined, localMs: number | null | undefined): Stamp | undefined => {
    if (chainRecord) {
      const seconds = uid ? chainTimeByUid.get(uid.toLowerCase()) : undefined
      return seconds !== undefined ? { iso: isoFromSeconds(seconds), clock: 'chain-block' } : undefined
    }
    const iso = isoFromMs(localMs)
    return iso ? { iso, clock: 'local-record' } : undefined
  }

  const versionStamp = stampOf(versionUid, source.versionMs)
  const bagStamp: Stamp = chainRecord
    ? { iso: isoFromSeconds(chainRecord.asOf), clock: 'chain-block' }
    : { iso: (options.baggingDate ?? new Date()).toISOString(), clock: 'export-device' }

  const chainId = getEasReadChainId()
  const chain = getEasChainDeployment(chainId)
  const explorerUrl = (uid: string) => (chain ? getEasAttestationExplorerUrl(chain, uid) : undefined)
  const schemaName = 'seedLocalId' in item ? item.getService?.().getSnapshot().context.schemaName : item.schemaName

  const omitted: ArchiveOmission[] = []
  const payload: BagFile[] = []
  const fileInfo = new Map<string, { mimeType: string; arweaveTransactionId?: string }>()
  const assetPathByTx = new Map<string, string>()
  const assetPathByProperty = new Map<string, string>()
  const htmlSources: { key: string; bytes: Uint8Array; text: string; arweaveTransactionId?: string }[] = []
  const properties: Record<string, ItemJsonProperty> = {}

  // A file's local name differs between clients (downloads are named after the transaction id), so
  // a reproducible bag has none, and types a file by its bytes alone.
  const mimeTypeOf = ({ bytes, fileName }: ArchiveFile & { bytes: Uint8Array }): string =>
    resolveUploadMimeType(fileName ? { fileName, bytes } : { bytes }) ?? 'application/octet-stream'

  const addAsset = (bytes: Uint8Array, mimeType: string, arweaveTransactionId?: string): string => {
    const ext = getExtensionForMimeType(mimeType)
    const path = `assets/${digestHex('sha256', bytes)}${ext ? `.${ext}` : ''}`
    if (!payload.some((f) => f.path === path)) {
      payload.push({ path, bytes })
      fileInfo.set(path, { mimeType, arweaveTransactionId })
    }
    if (arweaveTransactionId) assetPathByTx.set(arweaveTransactionId, path)
    return path
  }

  for (const property of source.properties) {
    const { key, definition: def, kind, value, attestationUid } = property
    const dataType = normalizeDataType(def.dataType) ?? String(def.dataType)
    const stamp = stampOf(attestationUid, property.recordedMs)
    const entry: ItemJsonProperty = {
      dataType,
      attestationUid,
      attestedAt: stamp?.iso,
      attestedAtClock: stamp?.clock,
    }
    properties[key] = entry

    if (kind === 'basic' || kind === 'storageTransaction') {
      entry.value = value ?? null
      continue
    }
    if (kind === 'relation' || kind === 'list') {
      // From the value: the publish graph doesn't walk the refs of a property that's already attested.
      const refs = await Promise.all(refsOf(value, kind).map(attestedRef))
      entry.value = kind === 'list' ? refs : (refs[0] ?? null)
      if (refs.some((ref) => !isPublishedSeedRef(ref))) {
        omitted.push({ property: key, reason: 'it refers to a seed that has no attestation uid' })
      }
      continue
    }

    if (kind === 'itemStorage') {
      const file = await source.readItemStorage(property)
      if (file === 'missing') omitted.push({ property: key, reason: 'its file is not on this device' })
      if (!file || file === 'missing' || !file.bytes) continue
      if (dataType === 'Html') {
        htmlSources.push({ key, bytes: file.bytes, text: new TextDecoder().decode(file.bytes) })
      } else {
        entry.file = addAsset(file.bytes, mimeTypeOf({ ...file, bytes: file.bytes }))
        assetPathByProperty.set(key, entry.file)
      }
      continue
    }

    // storageSeed: the value is a storage seed whose own attestations record the Arweave transaction.
    if (!hasValue(value)) continue
    const storageKind = storedValueKind(def, property)
    if (!storageKind || storageKind === 'itemStorage') {
      omitted.push({ property: key, reason: `${dataType} storage seeds are not exported yet` })
      continue
    }
    const file = await source.readStorageSeed(property, storageKind)
    const { bytes, arweaveTransactionId } = file
    if (arweaveTransactionId) entry.arweaveTransactionId = arweaveTransactionId
    if (!bytes) {
      const what = storageKind === 'html' ? 'Html' : 'file'
      omitted.push({ property: key, reason: `its ${what} could not be read or downloaded` })
      continue
    }
    if (storageKind === 'html') {
      htmlSources.push({ key, bytes, text: new TextDecoder().decode(bytes), arweaveTransactionId })
      continue
    }
    entry.file = addAsset(bytes, mimeTypeOf({ ...file, bytes }), arweaveTransactionId)
    assetPathByProperty.set(key, entry.file)
  }

  /** The bag path for an image the Html names by transaction id but no property holds (an embedded image). */
  const embeddedAssetPath = async (txId: string): Promise<string | undefined> => {
    const known = assetPathByTx.get(txId)
    if (known) return known
    const file = await source.readEmbeddedImage(txId)
    return file?.bytes ? addAsset(file.bytes, mimeTypeOf({ ...file, bytes: file.bytes }), txId) : undefined
  }

  const encoder = new TextEncoder()
  for (const html of htmlSources) {
    const targets = new Map<string, string>()
    // Collect first: rewriteHtmlUrls takes a synchronous mapping.
    rewriteHtmlUrls(html.text, (url) => {
      targets.set(url, url)
      return undefined
    })
    for (const url of targets.keys()) {
      if (url.startsWith(SEED_PROPERTY_REF_PREFIX)) {
        const path = assetPathByProperty.get(url.slice(SEED_PROPERTY_REF_PREFIX.length))
        if (path) targets.set(url, path)
        else targets.delete(url)
        continue
      }
      const txId = arweaveTxIdOfUrl(url)
      const path = txId ? await embeddedAssetPath(txId) : undefined
      if (path) targets.set(url, path)
      else {
        targets.delete(url)
        if (txId) omitted.push({ property: html.key, reason: `references ${url}, which is not in the bag` })
      }
    }
    const rewritten = rewriteHtmlUrls(html.text, (url) => targets.get(url))
    const viewPath = htmlSources.length === 1 ? 'index.html' : `${html.key}.html`
    payload.push({ path: viewPath, bytes: encoder.encode(rewritten) })
    fileInfo.set(viewPath, { mimeType: 'text/html' })
    const sourcePath = `source/${html.key}.html`
    payload.push({ path: sourcePath, bytes: html.bytes })
    fileInfo.set(sourcePath, { mimeType: 'text/html', arweaveTransactionId: html.arweaveTransactionId })
    properties[html.key]!.file = sourcePath
  }

  if (reproducible && omitted.length > 0) {
    throw new ArchiveExportError(
      'incomplete',
      `A reproducible bag can't leave anything out: ${omitted.map((o) => `${o.property} (${o.reason})`).join('; ')}`,
    )
  }

  const itemJson = {
    seedUid,
    versionUid,
    schemaName,
    modelName,
    chain: { id: chainId, name: chain?.name },
    attester,
    reproducible,
    ...(chainRecord ? { asOf: isoFromSeconds(chainRecord.asOf) } : {}),
    properties: Object.fromEntries(Object.entries(properties).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    omitted,
  }
  payload.push({ path: 'item.json', bytes: encoder.encode(`${JSON.stringify(itemJson, null, 2)}\n`) })
  fileInfo.set('item.json', { mimeType: 'application/json' })
  payload.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  // Descriptive metadata comes from the archive document, so nothing is guessed from property names.
  const primary = htmlSources[0]
  const doc = primary ? parseArchiveDocument(primary.text) : undefined
  const dc = dublinCoreXml({
    title: doc?.name,
    creator: doc?.authors,
    description: doc?.summary,
    date: doc?.published ?? versionStamp?.iso.slice(0, 10),
    type: 'Text',
    format: primary ? 'text/html' : undefined,
    identifier: [seedUid, explorerUrl(seedUid)].filter((v): v is string => !!v),
    source: doc?.url,
  })

  const history = await source.history(chainId)
  const premis = premisXml({
    objects: [
      {
        kind: 'intellectualEntity',
        identifiers: [
          { type: 'Seed Protocol seed UID', value: seedUid },
          { type: 'Seed Protocol version UID', value: versionUid },
        ],
      },
      ...payload.map((file): PremisFile => {
        const info = fileInfo.get(file.path)
        return {
          kind: 'file',
          identifiers: [{ type: 'bag path', value: `data/${file.path}` }],
          fixity: { 'SHA-256': digestHex('sha256', file.bytes), 'SHA-512': digestHex('sha512', file.bytes) },
          size: file.bytes.byteLength,
          formatName: info?.mimeType ?? 'application/octet-stream',
          // ar:// rather than a gateway URL: the gateway is configured per device.
          originalName: info?.arweaveTransactionId ? `ar://${info.arweaveTransactionId}` : undefined,
        }
      }),
    ],
    events: [...history, ...bagEvents(bagStamp, seedUid, chainId, reproducible)].sort(
      (a, b) => a.dateTime.localeCompare(b.dateTime) || a.identifier.value.localeCompare(b.identifier.value),
    ),
    agents: [
      ...(attester
        ? [{ identifiers: [{ type: 'EVM address', value: attester }], note: `EAS attester on chain ${chainId}` }]
        : []),
      { identifiers: [{ type: 'software', value: '@seedprotocol/sdk' }], name: '@seedprotocol/sdk', type: 'software' as const },
    ],
  })

  const info: BagInfoEntry[] = []
  if (options.sourceOrganization) info.push(['Source-Organization', options.sourceOrganization])
  info.push(['External-Identifier', seedUid])
  if (doc?.name) info.push(['External-Description', doc.name])
  info.push(['Seed-Uid', seedUid], ['Seed-Version-Uid', versionUid], ['Seed-Model', modelName])
  if (schemaName) info.push(['Seed-Schema', schemaName])
  info.push(['EAS-Chain-Id', String(chainId)])
  if (chain?.name) info.push(['EAS-Chain-Name', chain.name])
  if (attester) info.push(['EAS-Attester', attester])
  info.push(['Seed-Bag-Times', reproducible ? 'chain-block' : 'local-record'])
  if (reproducible) info.push(['Seed-Bag-Format', REPRODUCIBLE_BAG_FORMAT], ['Seed-Bag-As-Of', bagStamp.iso])

  const bag = createBag({
    payload,
    tagFiles: [
      { path: 'metadata/dc.xml', bytes: encoder.encode(dc) },
      { path: 'metadata/premis.xml', bytes: encoder.encode(premis) },
      {
        path: 'VERIFY.txt',
        bytes: encoder.encode(
          verifyInstructions({ seedUid, versionUid, explorerUrl: explorerUrl(versionUid), reproducible }),
        ),
      },
    ],
    info,
    baggingDate: new Date(bagStamp.iso),
    softwareAgent: SOFTWARE_AGENT,
  })
  const arweaveTransactions = chainRecord
    ? Object.fromEntries(
        [...fileInfo].flatMap(([path, { arweaveTransactionId }]) =>
          arweaveTransactionId ? [[`data/${path}`, arweaveTransactionId]] : [],
        ),
      )
    : {}
  return { bag, omitted, arweaveTransactions }
}

const historyAgents = (attester: string | undefined) =>
  attester ? [{ type: 'EVM address', value: attester, role: 'attester' }] : []

/**
 * The seed's history as EAS has it at the bag's time: its first Version as creation, later Versions
 * and the property attestations made after the current Version that hold its values then (patches)
 * as modifications. Times are block times. It stops at the current Version and leaves revocations
 * out: a revocation comes later than the record it's about, and would change the bytes of a bag
 * whose hash may already be anchored. EAS is where a reader checks one.
 */
function chainHistoryEvents(record: SeedAtTime, chainId: number): PremisEvent[] {
  const agents = historyAgents(record.seed.attester)
  const objects = [{ type: 'Seed Protocol seed UID', value: record.seed.id }]
  const time = `Time: ${describeClock('chain-block', chainId)}.`
  const current = record.version
  const currentIndex = record.versions.findIndex((v) => sameUid(v.id, current?.id))
  const events: PremisEvent[] = record.versions.slice(0, currentIndex + 1).map((v, index) => ({
    identifier: { type: 'EAS attestation UID', value: v.id },
    type: index === 0 ? 'creation' : 'modification',
    dateTime: isoFromSeconds(v.timeCreated),
    detail: `${index === 0 ? 'First Version attested' : 'New Version attested'}. ${time}`,
    outcome: 'success',
    agents,
    objects,
  }))
  for (const property of record.properties) {
    if (!current || property.timeCreated <= current.timeCreated) continue
    events.push({
      identifier: { type: 'EAS attestation UID', value: property.id },
      type: 'modification',
      dateTime: isoFromSeconds(property.timeCreated),
      detail: `Property schema ${property.schemaId} attested again on Version ${current.id}. ${time}`,
      outcome: 'success',
      agents,
      objects,
    })
  }
  return events
}

/**
 * The same history from this device's rows. Versions come from the versions table; patches are the
 * current properties whose attestation is newer than the current Version's. Attestations without a
 * recorded time are left out, since PREMIS events need one.
 */
async function localHistoryEvents(
  seedLocalId: string,
  seedUid: string,
  properties: PublishGraphProperty[],
  current: { uid: string; attestationCreatedAt: number | null },
  attester: string | undefined,
  chainId: number,
): Promise<PremisEvent[]> {
  const db = BaseDb.getAppDb()
  const agents = historyAgents(attester)
  const objects = [{ type: 'Seed Protocol seed UID', value: seedUid }]
  const time = `Time: ${describeClock('local-record', chainId)}.`

  type VersionRow = { uid: string | null; attestationCreatedAt: number | null; revokedAt: number | null }
  const versionRows = (
    (await db
      .select({ uid: versions.uid, attestationCreatedAt: versions.attestationCreatedAt, revokedAt: versions.revokedAt })
      .from(versions)
      .where(eq(versions.seedLocalId, seedLocalId))) as VersionRow[]
  )
    .filter((v) => isValidEasAttestationUid(v.uid) && v.attestationCreatedAt)
    .sort((a, b) => a.attestationCreatedAt! - b.attestationCreatedAt!)

  const events: PremisEvent[] = versionRows.map((v, index) => ({
    identifier: { type: 'EAS attestation UID', value: v.uid! },
    type: index === 0 ? 'creation' : 'modification',
    dateTime: isoFromMs(v.attestationCreatedAt)!,
    detail: `${index === 0 ? 'First Version attested' : 'New Version attested'}. ${time}`,
    outcome: 'success',
    outcomeNote: v.revokedAt ? `Version revoked at ${isoFromSeconds(v.revokedAt)}` : undefined,
    agents,
    objects,
  }))

  if (current.attestationCreatedAt) {
    for (const property of properties) {
      const row = property.row
      const uid = row?.uid
      if (!row || !isValidEasAttestationUid(uid) || !sameUid(row.versionUid, current.uid)) continue
      if (!row.attestationCreatedAt || row.attestationCreatedAt <= current.attestationCreatedAt) continue
      events.push({
        identifier: { type: 'EAS attestation UID', value: uid! },
        type: 'modification',
        dateTime: isoFromMs(row.attestationCreatedAt)!,
        detail: `Property ${property.key} attested again on Version ${current.uid}. ${time}`,
        outcome: 'success',
        agents,
        objects,
      })
    }
  }
  return events
}

/** The bag's own events: its checksums and the package itself. */
const bagEvents = (stamp: Stamp, seedUid: string, chainId: number, reproducible: boolean): PremisEvent[] => {
  const agents = [{ type: 'software', value: '@seedprotocol/sdk', role: 'executing program' }]
  const objects = [{ type: 'Seed Protocol seed UID', value: seedUid }]
  const time = reproducible
    ? `Dated with the time the bag covers so every client builds the same bag; time: ${describeClock(stamp.clock, chainId)}.`
    : `Time: ${describeClock(stamp.clock, chainId)}.`
  return [
    {
      identifier: { type: 'bag event', value: `message-digest-${stamp.iso}` },
      type: 'message digest calculation',
      dateTime: stamp.iso,
      detail: `SHA-256 and SHA-512 of every payload and tag file. ${time}`,
      outcome: 'success',
      agents,
      objects,
    },
    {
      identifier: { type: 'bag event', value: `package-${stamp.iso}` },
      type: 'information package creation',
      dateTime: stamp.iso,
      detail: `BagIt 1.0 bag written by exportArchive. ${time}`,
      outcome: 'success',
      agents,
      objects,
    },
  ]
}
