/**
 * Counts seeds, property attestations, and Arweave upload bytes for a publish
 * without building transactions or requiring a valid payload.
 */
import { BaseFileManager } from '@/helpers'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'
import { getPropertyClear } from '@/db/read/getPropertyClear'
import type { UnpublishedRelatedItem } from '@/db/read/publishErrors'
import { getPublishGraph, type PublishGraphNode, type PublishGraphProperty, type PublishMode } from '@/db/read/publishGraph'
import { getPublishUploadSources, type PublishUploadSource } from '@/db/read/getPublishUploads'

export type { PublishMode }

export type SummarizePublishWorkOptions = {
  publishMode?: PublishMode
}

export type PublishWorkSummary = {
  publishMode: PublishMode
  seedCount: number
  newSeedCount: number
  newVersionCount: number
  attestationCount: number
  /**
   * Property attestations publish revokes for retracted properties (ADR 0021). An EOA publisher
   * signs them in a second transaction.
   */
  revocationCount: number
  uploadCount: number
  uploadBytes: number
  /** Size of each upload, in bytes (Arweave charges per transaction, not only per byte). */
  uploadSizes: number[]
  /**
   * References the publish would attest to items whose seed was unpublished. When non-empty,
   * publishing fails with RelatedItemUnpublishedError before anything is sent.
   */
  unpublishedRelatedItems: UnpublishedRelatedItem[]
}

const DATA_URI = /^data:[^;]+;base64,([\s\S]*)$/i

/** Decoded byte length of a data-URI, or null if the string is not a base64 data URI. */
export function estimateDataUriByteLength(dataUri: string): number | null {
  const m = DATA_URI.exec((dataUri ?? '').trim())
  if (!m) return null
  const b64 = m[1]!.replace(/\s/g, '')
  if (!b64) return 0
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

/** Bytes an upload carries (a composite's children summed, as before framing). */
async function sourceBytes(source: PublishUploadSource): Promise<number> {
  let total = 0
  for (const filePath of source.children ? source.children.map((c) => c.filePath) : [source.filePath!]) {
    total += (await BaseFileManager.getFileSize(filePath)) ?? 0
  }
  return total
}

/**
 * What one property adds to the publish, by the payload's rules: one attestation, the
 * revocations of a retraction, or nothing.
 */
async function propertyWork(
  node: PublishGraphNode,
  property: PublishGraphProperty,
  forceFullSnapshot: boolean,
  uploaded: boolean,
): Promise<{ attestations: number; revocations: number }> {
  const none = { attestations: 0, revocations: 0 }
  const full = node.kind === 'root' || node.kind === 'draft'
  if (INTERNAL_PROPERTY_NAMES.includes(property.key) || property.deferred) return none
  if (property.kind === 'itemStorage') return none
  // The storage transaction slot attests this publish's upload of the node's file(s).
  if (property.kind === 'storageTransaction') return uploaded ? { attestations: 1, revocations: 0 } : none
  if (!full && property.kind !== 'basic') return none
  const value = property.row?.propertyValue
  if (value != null && value !== '') return property.uid && !forceFullSnapshot ? none : { attestations: 1, revocations: 0 }
  // An empty value attests a removal, or revokes for a retraction (ADR 0021)
  if (property.uid && !forceFullSnapshot) return none
  const clear = await getPropertyClear({
    seedLocalId: node.seedLocalId,
    seedUid: node.seedUid,
    propertyId: property.definition._dbId,
    modelName: node.modelName,
    propertyName: property.key,
    dataType: property.definition.dataType,
    refValueType: property.definition.refValueType,
  })
  if (!clear) return none
  return clear.retract ? { attestations: 0, revocations: clear.retractScope.length } : { attestations: 1, revocations: 0 }
}

export type PublishUploadSummary = Pick<
  PublishWorkSummary,
  'uploadCount' | 'uploadBytes' | 'uploadSizes' | 'unpublishedRelatedItems'
>

async function summarizeUploads(sources: PublishUploadSource[]): Promise<Pick<PublishWorkSummary, 'uploadCount' | 'uploadBytes' | 'uploadSizes'>> {
  const acc = { uploadCount: 0, uploadBytes: 0, uploadSizes: [] as number[] }
  for (const source of sources) {
    const bytes = await sourceBytes(source)
    if (bytes <= 0) continue
    acc.uploadCount += 1
    acc.uploadBytes += bytes
    acc.uploadSizes.push(bytes)
  }
  return acc
}

/**
 * What a publish of `item` would upload, by file size, and the references it would attest to
 * items whose seed was unpublished (revoked), the same ones getPublishPayload rejects with
 * RelatedItemUnpublishedError. Local reads only, and no file is read: the publish package checks
 * both before registering schemas or uploading anything.
 */
export const summarizePublishUploads = async (
  item: { seedLocalId: string; modelName?: string },
  options?: SummarizePublishWorkOptions,
): Promise<PublishUploadSummary> => {
  const graph = await getPublishGraph(item, { publishMode: options?.publishMode ?? 'patch' })
  const uploads = await summarizeUploads(await getPublishUploadSources(graph))
  return { ...uploads, unpublishedRelatedItems: graph.unpublishedRelatedItems }
}

/**
 * Local measurement of what a publish would do: seed/version/attestation counts
 * and Arweave upload byte totals. Does not hit the network or create transactions.
 */
export const summarizePublishWork = async (
  item: { seedLocalId: string; modelName?: string },
  options?: SummarizePublishWorkOptions,
): Promise<PublishWorkSummary> => {
  const publishMode: PublishMode = options?.publishMode ?? 'patch'
  const graph = await getPublishGraph(item, { publishMode })
  const sources = await getPublishUploadSources(graph)
  const acc: PublishWorkSummary = {
    publishMode,
    seedCount: graph.nodes.length,
    newSeedCount: 0,
    newVersionCount: 0,
    attestationCount: 0,
    revocationCount: 0,
    ...(await summarizeUploads(sources)),
    unpublishedRelatedItems: graph.unpublishedRelatedItems,
  }
  for (const node of graph.nodes) {
    if (node.newSeed) acc.newSeedCount += 1
    if (node.newSeed || graph.forceFullSnapshot) acc.newVersionCount += 1
    const uploaded = sources.some((s) => s.seedLocalId === node.seedLocalId)
    for (const property of node.properties) {
      const work = await propertyWork(node, property, graph.forceFullSnapshot, uploaded)
      acc.attestationCount += work.attestations
      acc.revocationCount += work.revocations
    }
  }
  return acc
}
