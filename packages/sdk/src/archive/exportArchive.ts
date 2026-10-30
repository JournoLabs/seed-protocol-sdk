import {
  createBag,
  digestHex,
  dublinCoreXml,
  parseArchiveDocument,
  premisXml,
  rewriteHtmlUrls,
  type Bag,
  type BagFile,
  type BagInfoEntry,
  type PremisEvent,
  type PremisFile,
} from '@seedprotocol/archive'
import { normalizeRelationPropertyValue, resolveSeedIdsFromRefString } from '@seedprotocol/arweave'
import {
  getCanonicalItemPropertiesFromEas,
  getEasAttestationExplorerUrl,
  getEasChainDeployment,
  getEasReadChainId,
  getItemVersionsFromEas,
  getSeedsByUidsFromEas,
  isValidEasAttestationUid,
  type Attestation,
} from '@seedprotocol/eas'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { findSeedRow } from '@/db/read/findSeedRow'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { getMetadata } from '@/db/read/getMetadata'
import { getPublishGraph, refsOf, type PublishGraphProperty } from '@/db/read/publishGraph'
import { resolveItemStorageChildFile } from '@/db/read/getPublishUploads'
import { findRelatedSeedRow, isLivePublishedSeed, isUnpublishedSeed } from '@/db/read/resolveRelatedSeedRef'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { findEmbeddedImageFilePath, SEED_PROPERTY_REF_PREFIX } from '@/helpers/htmlEmbeddedDataUriPublish'
import { getExtensionForMimeType, resolveUploadMimeType } from '@/helpers/mimeTypes'
import { normalizeDataType } from '@/helpers/property'
import { isPublishedSeedRef } from '@/helpers/relationSeedRef'
import { versions } from '@/seedSchema'
import { resolveStorageDisplay, storageSeedTransactionId, storedValueKind } from '@/storageValue/resolve'

/**
 * Exports a published item as a BagIt bag (RFC 8493) that an archive can ingest without Seed
 * code: its Html, its files and its attested values, with SHA-256/SHA-512 manifests, Dublin Core
 * and PREMIS metadata. See docs/ARCHIVE.md for the bag's layout.
 */

export type ExportArchiveOptions = {
  /** Download Images, Files and Html bodies that aren't on this device. Default true. */
  fetch?: boolean
  /**
   * Build the bag every client gets for this Version: times and the attester come from EAS, the
   * bag is dated with the Version's attestation, and nothing local to this device goes in. Needs
   * the EAS indexer, and refuses a copy that is behind the chain, a bag that would leave anything
   * out, and `sourceOrganization` or `baggingDate`. Default false.
   */
  reproducible?: boolean
  /** bag-info.txt Source-Organization, e.g. the publication. Left out when not given. */
  sourceOrganization?: string
  /** Bagging-Date and the time of the bag's own PREMIS events. Defaults to now. */
  baggingDate?: Date
}

/** Something the item has that the bag doesn't carry, and why. Also listed in data/item.json. */
export type ArchiveOmission = { property: string; reason: string }

export type ExportArchiveResult = { bag: Bag; omitted: ArchiveOmission[] }

export type ArchiveExportErrorCode =
  | 'not_published'
  | 'unpublished_changes'
  /** reproducible: this device's copy is behind what EAS has for the seed. */
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

type ExportableItem = {
  seedLocalId: string
  modelName?: string
  getService?: () => { getSnapshot: () => { context: { schemaName?: string } } }
}

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

/** What EAS has for the seed: its attestation, its Versions, and the current Version's properties. */
type ChainRecord = {
  seed: Attestation
  /** The seed attester's Versions, oldest first, revoked ones included. */
  versions: Attestation[]
  /** Newest property attestation per property schema on the current Version. */
  properties: Attestation[]
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

/**
 * Reads the seed's record from EAS and checks this device holds the same state: the newest live
 * Version is the one being exported, and every property attestation that holds a current value
 * on it is the one this device has.
 */
async function readChainRecord(
  seedUid: string,
  versionUid: string,
  localPropertyUids: Set<string>,
): Promise<ChainRecord> {
  let seed: Attestation | undefined
  let allVersions: Attestation[]
  let properties: Attestation[]
  try {
    ;[seed] = await getSeedsByUidsFromEas({ uids: [seedUid], excludeRevoked: false })
    allVersions = await getItemVersionsFromEas({ seedUids: [seedUid], excludeRevoked: false })
    properties = await getCanonicalItemPropertiesFromEas({ versionUids: [versionUid], excludeRevoked: true })
  } catch (error) {
    throw new ArchiveExportError('chain_unavailable', `Couldn't read seed ${seedUid} from EAS`, { cause: error })
  }
  if (!seed || !sameUid(seed.id, seedUid)) {
    throw new ArchiveExportError('not_synced', `EAS has no seed attestation ${seedUid}`)
  }
  const versionsOfSeed = allVersions
    .filter((v) => sameUid(v.attester, seed!.attester))
    .sort((a, b) => a.timeCreated - b.timeCreated || a.id.localeCompare(b.id))
  const newestLive = versionsOfSeed.filter((v) => !v.revoked).at(-1)
  if (!newestLive || !sameUid(newestLive.id, versionUid)) {
    throw new ArchiveExportError(
      'not_synced',
      `The newest live Version on EAS is ${newestLive?.id ?? 'none'}, not ${versionUid}; sync the seed first`,
    )
  }
  const missing = properties.filter((p) => !localPropertyUids.has(p.id.toLowerCase())).map((p) => p.id)
  if (missing.length > 0) {
    throw new ArchiveExportError(
      'not_synced',
      `Property attestations ${missing.join(', ')} on Version ${versionUid} aren't on this device; sync the seed first`,
    )
  }
  return { seed, versions: versionsOfSeed, properties }
}

/**
 * Builds the bag for `item`'s current published state:
 *
 * - `data/index.html` (or `data/<property>.html` when the model has several Html properties): the
 *   Html with references to files in the bag rewritten to relative paths.
 * - `data/source/<property>.html`: each Html exactly as published.
 * - `data/assets/<sha256>.<ext>`: Images, Files and images the Html references.
 * - `data/item.json`: every property's value, attestation uid and Arweave transaction.
 * - `metadata/dc.xml` and `metadata/premis.xml`.
 *
 * Every time in the bag says whose clock it came from ({@link ArchiveClockSource}). With
 * `reproducible`, every client with the same Version synced and the same schema gets the same
 * bytes, so the same tagmanifest hash.
 *
 * Throws {@link ArchiveExportError} `not_published` for an item without a live published version,
 * and `unpublished_changes` when a property holds a saved value that isn't published yet.
 * A file that can't be read or downloaded is left out and reported in `omitted`, not thrown,
 * except with `reproducible`.
 */
export async function exportArchive(item: ExportableItem, options: ExportArchiveOptions = {}): Promise<ExportArchiveResult> {
  const fetch = options.fetch ?? true
  const reproducible = options.reproducible ?? false
  if (reproducible && (options.sourceOrganization !== undefined || options.baggingDate !== undefined)) {
    throw new ArchiveExportError(
      'invalid_options',
      'A reproducible bag takes no sourceOrganization or baggingDate: they would differ between clients',
    )
  }
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

  const localPropertyUids = new Set(
    root.properties.map(propertyUid).filter((uid): uid is string => !!uid).map((uid) => uid.toLowerCase()),
  )
  const chainRecord = reproducible ? await readChainRecord(seedUid, version.uid, localPropertyUids) : undefined
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

  const versionStamp = stampOf(version.uid, version.attestationCreatedAt)
  const bagStamp: Stamp = chainRecord
    ? versionStamp!
    : { iso: (options.baggingDate ?? new Date()).toISOString(), clock: 'export-device' }

  const chainId = getEasReadChainId()
  const chain = getEasChainDeployment(chainId)
  const explorerUrl = (uid: string) => (chain ? getEasAttestationExplorerUrl(chain, uid) : undefined)
  const schemaName = item.getService?.().getSnapshot().context.schemaName
  const attester = chainRecord?.seed.attester ?? seedRow?.publisher ?? undefined

  const omitted: ArchiveOmission[] = []
  const payload: BagFile[] = []
  const fileInfo = new Map<string, { mimeType: string; arweaveTransactionId?: string }>()
  const assetPathByTx = new Map<string, string>()
  const assetPathByProperty = new Map<string, string>()
  const htmlSources: { key: string; text: string; arweaveTransactionId?: string }[] = []
  const properties: Record<string, ItemJsonProperty> = {}

  // A file's local name differs between clients (downloads are named after the transaction id), so
  // a reproducible bag types a file by its bytes alone.
  const mimeTypeOf = (filePath: string, bytes: Uint8Array): string =>
    resolveUploadMimeType(reproducible ? { bytes } : { fileName: filePath, bytes }) ?? 'application/octet-stream'

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

  for (const property of root.properties) {
    const { key, definition: def, kind, row } = property
    const dataType = normalizeDataType(def.dataType) ?? String(def.dataType)
    const attestationUid = propertyUid(property)
    const stamp = stampOf(attestationUid, row?.attestationCreatedAt)
    const entry: ItemJsonProperty = {
      dataType,
      attestationUid,
      attestedAt: stamp?.iso,
      attestedAtClock: stamp?.clock,
    }
    properties[key] = entry

    if (kind === 'basic' || kind === 'storageTransaction') {
      entry.value = row?.propertyValue ?? null
      continue
    }
    if (kind === 'relation' || kind === 'list') {
      // From the row: the publish graph doesn't walk the refs of a property that's already attested.
      const refs = await Promise.all(refsOf(row?.propertyValue, kind).map(attestedRef))
      entry.value = kind === 'list' ? refs : (refs[0] ?? null)
      if (refs.some((ref) => !isPublishedSeedRef(ref))) {
        omitted.push({ property: key, reason: 'it refers to a seed that has no attestation uid' })
      }
      continue
    }

    if (kind === 'itemStorage') {
      const { filePath } = await resolveItemStorageChildFile(root, property)
      if (!filePath) {
        if (row && hasValue(row.propertyValue)) omitted.push({ property: key, reason: 'its file is not on this device' })
        continue
      }
      const bytes = await readBytes(filePath)
      if (dataType === 'Html') {
        htmlSources.push({ key, text: new TextDecoder().decode(bytes) })
      } else {
        entry.file = addAsset(bytes, mimeTypeOf(filePath, bytes))
        assetPathByProperty.set(key, entry.file)
      }
      continue
    }

    // storageSeed: the value is a storage seed whose own row records the Arweave transaction.
    if (!row || !hasValue(row.propertyValue)) continue
    const storageKind = storedValueKind(def, row)
    if (!storageKind || storageKind === 'itemStorage') {
      omitted.push({ property: key, reason: `${dataType} storage seeds are not exported yet` })
      continue
    }
    const arweaveTransactionId = await storageSeedTransactionId(
      resolveSeedIdsFromRefString(normalizeRelationPropertyValue(row.propertyValue) ?? ''),
    )
    if (arweaveTransactionId) entry.arweaveTransactionId = arweaveTransactionId
    // The bag keeps each Html exactly as published
    const display = await resolveStorageDisplay(storageKind, row, { fetch, rehostLinks: false })

    if (storageKind === 'html') {
      const text = display.filePath ? await BaseFileManager.readFileAsString(display.filePath) : display.renderValue
      if (text === undefined) {
        omitted.push({ property: key, reason: 'its Html could not be read or downloaded' })
        continue
      }
      htmlSources.push({ key, text, arweaveTransactionId })
      continue
    }
    if (!display.filePath) {
      omitted.push({ property: key, reason: 'its file could not be read or downloaded' })
      continue
    }
    const bytes = await readBytes(display.filePath)
    entry.file = addAsset(bytes, mimeTypeOf(display.filePath, bytes), arweaveTransactionId)
    assetPathByProperty.set(key, entry.file)
  }

  /** The bag path for an image the Html names by transaction id but no property holds (an embedded image). */
  const embeddedAssetPath = async (txId: string): Promise<string | undefined> => {
    const known = assetPathByTx.get(txId)
    if (known) return known
    const imageRow = await getMetadata({ storageTransactionId: txId })
    let filePath = imageRow?.seedLocalId ? await findEmbeddedImageFilePath(imageRow.seedLocalId) : undefined
    if (!filePath) {
      const display = await resolveStorageDisplay('image', { refResolvedValue: txId, localStorageDir: '/images' }, { fetch })
      filePath = display.filePath
    }
    if (!filePath) return undefined
    const bytes = await readBytes(filePath)
    return addAsset(bytes, mimeTypeOf(filePath, bytes), txId)
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
    payload.push({ path: sourcePath, bytes: encoder.encode(html.text) })
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
    versionUid: version.uid,
    schemaName,
    modelName: root.modelName,
    chain: { id: chainId, name: chain?.name },
    attester,
    reproducible,
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

  const history = chainRecord
    ? chainHistoryEvents(chainRecord, version.uid, chainId)
    : await localHistoryEvents(root.seedLocalId, seedUid, root.properties, version, attester, chainId)
  const premis = premisXml({
    objects: [
      {
        kind: 'intellectualEntity',
        identifiers: [
          { type: 'Seed Protocol seed UID', value: seedUid },
          { type: 'Seed Protocol version UID', value: version.uid },
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
  info.push(['Seed-Uid', seedUid], ['Seed-Version-Uid', version.uid], ['Seed-Model', root.modelName])
  if (schemaName) info.push(['Seed-Schema', schemaName])
  info.push(['EAS-Chain-Id', String(chainId)])
  if (chain?.name) info.push(['EAS-Chain-Name', chain.name])
  if (attester) info.push(['EAS-Attester', attester])
  info.push(['Seed-Bag-Times', reproducible ? 'chain-block' : 'local-record'])
  if (reproducible) info.push(['Seed-Bag-Format', REPRODUCIBLE_BAG_FORMAT])

  const bag = createBag({
    payload,
    tagFiles: [
      { path: 'metadata/dc.xml', bytes: encoder.encode(dc) },
      { path: 'metadata/premis.xml', bytes: encoder.encode(premis) },
    ],
    info,
    baggingDate: new Date(bagStamp.iso),
    softwareAgent: SOFTWARE_AGENT,
  })
  return { bag, omitted }
}

const historyAgents = (attester: string | undefined) =>
  attester ? [{ type: 'EVM address', value: attester, role: 'attester' }] : []

/**
 * The seed's history as EAS has it: its first Version as creation, later Versions and the property
 * attestations made after the current Version that hold its current values (patches) as
 * modifications. Times are block times. It stops at the current Version and leaves revocations out:
 * a revocation comes later than the record it's about, and would change the bytes of a bag whose
 * hash may already be anchored. EAS is where a reader checks one.
 */
function chainHistoryEvents(record: ChainRecord, currentVersionUid: string, chainId: number): PremisEvent[] {
  const agents = historyAgents(record.seed.attester)
  const objects = [{ type: 'Seed Protocol seed UID', value: record.seed.id }]
  const time = `Time: ${describeClock('chain-block', chainId)}.`
  const currentIndex = record.versions.findIndex((v) => sameUid(v.id, currentVersionUid))
  const events: PremisEvent[] = record.versions.slice(0, currentIndex + 1).map((v, index) => ({
    identifier: { type: 'EAS attestation UID', value: v.id },
    type: index === 0 ? 'creation' : 'modification',
    dateTime: isoFromSeconds(v.timeCreated),
    detail: `${index === 0 ? 'First Version attested' : 'New Version attested'}. ${time}`,
    outcome: 'success',
    agents,
    objects,
  }))
  const current = record.versions[currentIndex]
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
    ? `Dated with the Version's attestation so every client builds the same bag; time: ${describeClock(stamp.clock, chainId)}.`
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
