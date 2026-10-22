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
import {
  getPublicArweaveRawUrl,
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '@seedprotocol/arweave'
import {
  getEasAttestationExplorerUrl,
  getEasChainDeployment,
  getEasReadChainId,
  isValidEasAttestationUid,
} from '@seedprotocol/eas'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { findSeedRow } from '@/db/read/findSeedRow'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { getMetadata } from '@/db/read/getMetadata'
import { getPublishGraph, type PublishGraphProperty } from '@/db/read/publishGraph'
import { resolveItemStorageChildFile } from '@/db/read/getPublishUploads'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { findEmbeddedImageFilePath, SEED_PROPERTY_REF_PREFIX } from '@/helpers/htmlEmbeddedDataUriPublish'
import { getExtensionForMimeType, resolveUploadMimeType } from '@/helpers/mimeTypes'
import { normalizeDataType } from '@/helpers/property'
import { metadata, versions } from '@/seedSchema'
import { resolveStorageDisplay, storageSeedTransactionId, storedValueKind } from '@/storageValue/resolve'

/**
 * Exports a published item as a BagIt bag (RFC 8493) that an archive can ingest without Seed
 * code: its Html, its files and its attested values, with SHA-256/SHA-512 manifests, Dublin Core
 * and PREMIS metadata. See docs/ARCHIVE.md for the bag's layout.
 */

export type ExportArchiveOptions = {
  /** Download Images, Files and Html bodies that aren't on this device. Default true. */
  fetch?: boolean
  /** bag-info.txt Source-Organization, e.g. the publication. Left out when not given. */
  sourceOrganization?: string
  /** Bagging-Date and the time of the bag's own PREMIS events. Defaults to now. */
  baggingDate?: Date
}

/** Something the item has that the bag doesn't carry, and why. Also listed in data/item.json. */
export type ArchiveOmission = { property: string; reason: string }

export type ExportArchiveResult = { bag: Bag; omitted: ArchiveOmission[] }

export type ArchiveExportErrorCode = 'not_published' | 'unpublished_changes'

/** The item can't be exported as it is. `code` says why. */
export class ArchiveExportError extends Error {
  readonly code: ArchiveExportErrorCode

  constructor(code: ArchiveExportErrorCode, message: string) {
    super(message)
    this.name = 'ArchiveExportError'
    this.code = code
  }
}

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
}

const ARWEAVE_TX_ID = /^[a-z0-9_-]{43}$/i
const SOFTWARE_AGENT = '@seedprotocol/sdk exportArchive (https://github.com/JournoLabs/seed-protocol-sdk)'

const isoFromMs = (ms: number | null | undefined): string | undefined =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined

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
 * Throws {@link ArchiveExportError} `not_published` for an item without a live published version,
 * and `unpublished_changes` when a property holds a saved value that isn't published yet.
 * A file that can't be read or downloaded is left out and reported in `omitted`, not thrown.
 */
export async function exportArchive(item: ExportableItem, options: ExportArchiveOptions = {}): Promise<ExportArchiveResult> {
  const fetch = options.fetch ?? true
  const now = options.baggingDate ?? new Date()
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

  const chainId = getEasReadChainId()
  const chain = getEasChainDeployment(chainId)
  const explorerUrl = (uid: string) => (chain ? getEasAttestationExplorerUrl(chain, uid) : undefined)
  const schemaName = item.getService?.().getSnapshot().context.schemaName
  const attester = seedRow?.publisher ?? undefined

  const omitted: ArchiveOmission[] = []
  const payload: BagFile[] = []
  const fileInfo = new Map<string, { mimeType: string; arweaveTransactionId?: string }>()
  const assetPathByTx = new Map<string, string>()
  const assetPathByProperty = new Map<string, string>()
  const htmlSources: { key: string; text: string; arweaveTransactionId?: string }[] = []
  const properties: Record<string, ItemJsonProperty> = {}

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
    const entry: ItemJsonProperty = {
      dataType,
      attestationUid: row?.uid ?? row?.derivedFromUid ?? undefined,
      attestedAt: isoFromMs(row?.attestationCreatedAt),
    }
    properties[key] = entry

    if (kind === 'basic' || kind === 'storageTransaction') {
      entry.value = row?.propertyValue ?? null
      continue
    }
    if (kind === 'relation' || kind === 'list') {
      entry.value = kind === 'list' ? property.refs.map((r) => r.ref) : (property.refs[0]?.ref ?? null)
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
        const mimeType = resolveUploadMimeType({ fileName: filePath, bytes }) ?? 'application/octet-stream'
        entry.file = addAsset(bytes, mimeType)
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
    const display = await resolveStorageDisplay(storageKind, row, { fetch })

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
    const mimeType = resolveUploadMimeType({ fileName: display.filePath, bytes }) ?? 'application/octet-stream'
    entry.file = addAsset(bytes, mimeType, arweaveTransactionId)
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
    const mimeType = resolveUploadMimeType({ fileName: filePath, bytes }) ?? 'application/octet-stream'
    return addAsset(bytes, mimeType, txId)
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

  const itemJson = {
    seedUid,
    versionUid: version.uid,
    schemaName,
    modelName: root.modelName,
    chain: { id: chainId, name: chain?.name },
    attester,
    properties,
    omitted,
  }
  payload.push({ path: 'item.json', bytes: encoder.encode(`${JSON.stringify(itemJson, null, 2)}\n`) })
  fileInfo.set('item.json', { mimeType: 'application/json' })

  // Descriptive metadata comes from the archive document, so nothing is guessed from property names.
  const primary = htmlSources[0]
  const doc = primary ? parseArchiveDocument(primary.text) : undefined
  const versionDate = isoFromMs(version.attestationCreatedAt)
  const dc = dublinCoreXml({
    title: doc?.name,
    creator: doc?.authors,
    description: doc?.summary,
    date: doc?.published ?? versionDate?.slice(0, 10),
    type: 'Text',
    format: primary ? 'text/html' : undefined,
    identifier: [seedUid, explorerUrl(seedUid)].filter((v): v is string => !!v),
    source: doc?.url,
  })

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
          originalName: info?.arweaveTransactionId ? getPublicArweaveRawUrl(info.arweaveTransactionId) : undefined,
        }
      }),
    ],
    events: [...(await historyEvents(root.seedLocalId, seedUid, version, attester)), ...bagEvents(now, seedUid)],
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

  const bag = createBag({
    payload,
    tagFiles: [
      { path: 'metadata/dc.xml', bytes: encoder.encode(dc) },
      { path: 'metadata/premis.xml', bytes: encoder.encode(premis) },
    ],
    info,
    baggingDate: now,
    softwareAgent: SOFTWARE_AGENT,
  })
  return { bag, omitted }
}

/**
 * The seed's attested history: its first live Version as creation, later Versions and property
 * attestations made after the current Version (patches) as modifications. Attestations without
 * a recorded time are left out, since PREMIS events need one.
 */
async function historyEvents(
  seedLocalId: string,
  seedUid: string,
  current: { uid: string; attestationCreatedAt: number | null },
  attester: string | undefined,
): Promise<PremisEvent[]> {
  const db = BaseDb.getAppDb()
  const agents = attester ? [{ type: 'EVM address', value: attester, role: 'attester' }] : []
  const objects = [{ type: 'Seed Protocol seed UID', value: seedUid }]

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
    detail: index === 0 ? 'First Version attested' : 'New Version attested',
    outcome: 'success',
    outcomeNote: v.revokedAt ? `Version revoked at ${new Date(v.revokedAt * 1000).toISOString()}` : undefined,
    agents,
    objects,
  }))

  if (current.attestationCreatedAt) {
    const patches = (await db
      .select({ uid: metadata.uid, propertyName: metadata.propertyName, attestationCreatedAt: metadata.attestationCreatedAt })
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.versionUid, current.uid)))) as {
      uid: string | null
      propertyName: string | null
      attestationCreatedAt: number | null
    }[]
    for (const row of patches) {
      if (!isValidEasAttestationUid(row.uid) || !row.attestationCreatedAt) continue
      if (row.attestationCreatedAt <= current.attestationCreatedAt) continue
      events.push({
        identifier: { type: 'EAS attestation UID', value: row.uid! },
        type: 'modification',
        dateTime: isoFromMs(row.attestationCreatedAt)!,
        detail: `Property ${row.propertyName} attested again on Version ${current.uid}`,
        outcome: 'success',
        agents,
        objects,
      })
    }
  }
  return events.sort((a, b) => a.dateTime.localeCompare(b.dateTime))
}

/** The bag's own events: its checksums and the package itself. */
const bagEvents = (now: Date, seedUid: string): PremisEvent[] => {
  const agents = [{ type: 'software', value: '@seedprotocol/sdk', role: 'executing program' }]
  const objects = [{ type: 'Seed Protocol seed UID', value: seedUid }]
  const dateTime = now.toISOString()
  return [
    {
      identifier: { type: 'bag event', value: `message-digest-${dateTime}` },
      type: 'message digest calculation',
      dateTime,
      detail: 'SHA-256 and SHA-512 of every payload and tag file',
      outcome: 'success',
      agents,
      objects,
    },
    {
      identifier: { type: 'bag event', value: `package-${dateTime}` },
      type: 'information package creation',
      dateTime,
      detail: 'BagIt 1.0 bag written by exportArchive',
      outcome: 'success',
      agents,
      objects,
    },
  ]
}
