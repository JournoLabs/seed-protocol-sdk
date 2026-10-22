import { eq } from 'drizzle-orm'
import { isValidEasAttestationUid } from '@seedprotocol/eas'
import { normalizeRelationPropertyValue, resolveSeedIdsFromRefString } from '@seedprotocol/arweave'
import { BaseDb } from '@/db/Db/BaseDb'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { findSeedRow, type FoundSeedRow } from '@/db/read/findSeedRow'
import { currentPropertyRow, type CurrentPropertyRow } from '@/db/read/currentPropertyRow'
import { getLatestVersionRow } from '@/db/read/getLatestVersionRow'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { metadataPropertyNameForms, readModelMetadataProperties } from '@/db/read/metadataProperty'
import { resolveModelRecord, resolveModelRecordByNameOrType } from '@/db/read/resolveModelRecord'
import {
  findRelatedSeedRow,
  isLivePublishedSeed,
  isUnpublishedSeed,
  relatedModelNameFromDef,
} from '@/db/read/resolveRelatedSeedRef'
import { isVersionRevoked } from '@/db/read/subqueries/liveVersion'
import type { UnpublishedRelatedItem } from '@/db/read/publishErrors'
import { getPropertyDefinitions, type PropertyDefinition } from '@/helpers/propertyDefinition'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { isPublishedSeedRef } from '@/helpers/relationSeedRef'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'

/**
 * The seeds one publish attests, read from rows once (audit T11, decision D3). The payload, the
 * uploads, the cost estimate, the upload-candidate check, the early revoked-ref check, the Html
 * embedded-image passes and EAS schema registration all read this graph; none of them reads an
 * Item or ItemProperty instance.
 *
 * The publish attests the root and every draft (no seed uid yet) reachable from it:
 * - through relation and list-of-relation properties: model items, each with its full property set;
 * - through storage-seed properties (Image, File, Html, Json, or a Relation to one): storage seeds,
 *   which attest their own basic properties;
 * - through the root's and the model drafts' Html-embedded image rows (htmlEmbeddedImageCoPublish).
 * Already-published targets are referenced by their current uid and not walked into; revoked ones
 * stop the publish (RelatedItemUnpublishedError).
 *
 * Walk order: depth first; per node, relation and storage-seed properties in model order, then
 * embedded images, then lists. `nodes` is the order nodes finish, so a node comes after the
 * nodes it refers to and the root is last.
 *
 * Cycles: an item can only attest the uid of a seed published before it in the same publish, so a
 * ref back to an item still being walked (one that gets a new seed in this publish) can't be
 * attested. Such a property is deferred: left out of this publish (it keeps no uid, so the next
 * publish of its item attests it, with the target's uid). For A ↔ B reached from A, A attests B's
 * uid and B's relation to A is deferred. A list with a back reference is deferred whole; its other
 * draft members are still published, unlinked.
 */

/** How a property takes part in a publish. */
export type PublishPropertyKind =
  /** Attested with its value. */
  | 'basic'
  /** A Relation to a model item. */
  | 'relation'
  /** A List of Relation. */
  | 'list'
  /** Image, File, Html or Json, or a Relation to one: its value is a storage seed. */
  | 'storageSeed'
  /** The node's own Arweave transaction slot (`storageTransactionId`). */
  | 'storageTransaction'
  /** An ItemStorage file, uploaded inside the node's composite upload. */
  | 'itemStorage'

/** A seed one of a property's values names. */
export type PublishGraphRef = {
  /** The value as stored (local id, or uid). */
  ref: string
  /** The local seed it resolves to, also for the old uid of a seed published again since. */
  seedLocalId?: string
  /** The node this publish attests for it (a draft). */
  node?: PublishGraphNode
}

export type PublishGraphProperty = {
  /** Schema key. */
  key: string
  definition: PropertyDefinition
  kind: PublishPropertyKind
  /** The property's current row. Publish waits for the outbox first, so no pending overlay. */
  row?: CurrentPropertyRow
  /** The row's attestation uid, when the row is attested. */
  uid?: string
  /**
   * Whether this publish walks the property's refs: it has a value, and no uid unless the
   * publish attests every property (`forceFullSnapshot`).
   */
  walked: boolean
  /** Points back at an item still being walked: left out of this publish. */
  deferred: boolean
  /** Relation, list and storage-seed values: the seeds named, in order. */
  refs: PublishGraphRef[]
}

export type PublishGraphNodeKind = 'root' | 'draft' | 'storageSeed' | 'embeddedImage'

export type EmbeddedImageRow = typeof htmlEmbeddedImageCoPublish.$inferSelect

export type PublishGraphNode = {
  seedLocalId: string
  kind: PublishGraphNodeKind
  /** The seed's attestation uid; undefined for a draft. */
  seedUid?: string
  /** Gets a new seed attestation: a draft, or a revoked root published again. */
  newSeed: boolean
  modelName: string
  /** `seeds.schema_uid`. */
  seedSchemaUid?: string
  /** The head version row; `publishedUid` is the newest attested one (a draft version may be newer). */
  version: { localId?: string; uid?: string; publishedUid?: string }
  /** Every property of the node's model. */
  properties: PublishGraphProperty[]
  /** Properties in this publish that are filled with this node's new seed uid (propertiesToUpdate). */
  links: { seedLocalId: string; propertyKey: string }[]
  /** Html-embedded image rows of this node (root and model drafts only). */
  embeddedImages: EmbeddedImageRow[]
}

/** A ref the walk could not follow. */
export type PublishGraphBrokenRef = {
  seedLocalId: string
  propertyKey: string
  ref: string
  /** `invalid`: neither a local id nor a uid. `missing`: a local id with no local seed (or no model). */
  reason: 'invalid' | 'missing'
  list: boolean
}

export type PublishGraph = {
  root: PublishGraphNode
  /** Every node, in the order the walk finishes them: referenced nodes first, the root last. */
  nodes: PublishGraphNode[]
  /** `new_version`, or a revoked root published again: properties with a uid are attested again. */
  forceFullSnapshot: boolean
  /** The root's seed was revoked: it gets a new seed attestation. */
  republishRevokedSeed: boolean
  /** Refs to seeds whose attestation was revoked; the publish stops with RelatedItemUnpublishedError. */
  unpublishedRelatedItems: UnpublishedRelatedItem[]
  /** Refs (local id, or a republished seed's old uid) to live published seeds, mapped to their current uid. */
  relatedRefUids: Map<string, string>
  brokenRefs: PublishGraphBrokenRef[]
  /** Embedded image rows whose image seed has no local row. */
  missingEmbeddedImages: { seedLocalId: string; imageSeedLocalId: string }[]
}

export type PublishMode = 'patch' | 'new_version'

export type GetPublishGraphOptions = {
  /** `patch` (default): properties with a uid are left out. `new_version`: every property is attested. */
  publishMode?: PublishMode
}

const STORAGE_SEED_TYPES = new Set<string>([
  ModelPropertyDataTypes.Image,
  ModelPropertyDataTypes.File,
  ModelPropertyDataTypes.Html,
  ModelPropertyDataTypes.Json,
])

export const isStorageTransactionPropertyName = (name: string | undefined): boolean =>
  name === 'storageTransactionId' || name === 'storage_transaction_id'

export function publishPropertyKind(key: string, def: PropertyDefinition): PublishPropertyKind {
  const dataType = normalizeDataType(def.dataType)
  const refValueType = normalizeDataType(def.refValueType)
  if (STORAGE_SEED_TYPES.has(dataType)) return 'storageSeed'
  if (dataType === ModelPropertyDataTypes.Relation) {
    return STORAGE_SEED_TYPES.has(refValueType) ? 'storageSeed' : 'relation'
  }
  if (dataType === ModelPropertyDataTypes.List) return def.ref || def.refModelName ? 'list' : 'basic'
  if (def.storageType === 'ItemStorage') return 'itemStorage'
  if (isStorageTransactionPropertyName(key)) return 'storageTransaction'
  return 'basic'
}

const isEmptyValue = (value: string | null | undefined): boolean => value == null || value.trim() === ''

/** The seed refs a property's stored value names: one (Relation, storage seed) or each list member. */
function refsOf(value: string | null | undefined, kind: PublishPropertyKind): string[] {
  if (isEmptyValue(value)) return []
  if (kind === 'list') {
    return parseListPropertyValueFromStorage(value!)
      .map((member) => normalizeRelationPropertyValue(member))
      .filter((ref): ref is string => !!ref)
  }
  const ref = normalizeRelationPropertyValue(value)
  return ref ? [ref] : []
}

type SeedModel = { id: number; name: string }

async function modelOfSeed(seed: FoundSeedRow, modelNameHint?: string): Promise<SeedModel | undefined> {
  if (seed.modelFileId) {
    const model = await resolveModelRecord(undefined, { modelFileId: seed.modelFileId })
    if (model) return model
  }
  return (await resolveModelRecordByNameOrType(seed.type ?? modelNameHint, {})) ?? undefined
}

/** One seed with its model's properties and their current rows. Undefined when the seed or its model isn't local. */
async function readNode(
  seedLocalId: string,
  kind: PublishGraphNodeKind,
  modelNameHint?: string,
): Promise<PublishGraphNode | undefined> {
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  const seed = await findSeedRow({ localId: seedLocalId })
  if (!seed) return undefined
  const model = await modelOfSeed(seed, modelNameHint)
  if (!model) return undefined

  const definitions = await getPropertyDefinitions(model.id)
  const metadataProperties = await readModelMetadataProperties(db, model.id)
  const seedUid = isValidEasAttestationUid(seed.uid) ? seed.uid! : undefined
  const seedRef = { seedLocalId: seed.localId, seedUid }

  const properties: PublishGraphProperty[] = []
  for (const [key, definition] of definitions) {
    const property = metadataProperties.find((p) => p.id === definition._dbId)
    const match = property
      ? { property, propertyId: property.id, names: metadataPropertyNameForms(property) }
      : { property: undefined, propertyId: null, names: [key] }
    const row = await currentPropertyRow(seedRef, { match, propertyName: key }, { overlay: false })
    const propertyKind = publishPropertyKind(key, definition)
    properties.push({
      key,
      definition,
      kind: propertyKind,
      row,
      uid: isValidEasAttestationUid(row?.uid) ? row!.uid! : undefined,
      walked: false,
      deferred: false,
      refs: [],
    })
  }

  const head = await getLatestVersionRow(seed.localId)
  const published = seedUid ? await getLatestPublishedVersionRow(seed.localId) : null
  const isFullNode = kind === 'root' || kind === 'draft'
  const embeddedImages = isFullNode
    ? await db.select().from(htmlEmbeddedImageCoPublish).where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, seed.localId))
    : []

  return {
    seedLocalId: seed.localId,
    kind,
    seedUid,
    newSeed: !seedUid || (kind === 'root' && isVersionRevoked(seed.revokedAt)),
    modelName: model.name,
    seedSchemaUid: isValidEasAttestationUid(seed.schemaUid) ? seed.schemaUid! : undefined,
    version: {
      localId: head?.localId ?? undefined,
      uid: isValidEasAttestationUid(head?.uid) ? head!.uid! : undefined,
      publishedUid: published?.uid,
    },
    properties,
    links: [],
    embeddedImages,
  }
}

/** The Html property of `node` whose value is the Html storage seed `htmlSeedLocalId`. */
export function htmlPropertyForHtmlSeed(node: PublishGraphNode, htmlSeedLocalId: string): PublishGraphProperty | undefined {
  const want = htmlSeedLocalId.trim()
  return node.properties.find(
    (p) => normalizeDataType(p.definition.dataType) === ModelPropertyDataTypes.Html && p.row?.propertyValue?.trim() === want,
  )
}

/**
 * The publish graph of the seed `root` (an Item, or its local id). Reads rows only; call after the
 * outbox has drained (waitForPendingOutboxOps) so every edit is in its row.
 */
export async function getPublishGraph(
  root: { seedLocalId: string; modelName?: string },
  options: GetPublishGraphOptions = {},
): Promise<PublishGraph> {
  const rootNode = await readNode(root.seedLocalId, 'root', root.modelName)
  if (!rootNode) throw new Error(`Cannot publish ${root.seedLocalId}: no local seed with a known model`)
  const republishRevokedSeed = !!rootNode.seedUid && rootNode.newSeed
  const forceFullSnapshot = options.publishMode === 'new_version' || republishRevokedSeed

  const graph: PublishGraph = {
    root: rootNode,
    nodes: [],
    forceFullSnapshot,
    republishRevokedSeed,
    unpublishedRelatedItems: [],
    relatedRefUids: new Map(),
    brokenRefs: [],
    missingEmbeddedImages: [],
  }
  const nodes = new Map<string, PublishGraphNode>([[rootNode.seedLocalId, rootNode]])
  // Items getting a new seed in this publish whose walk hasn't finished: a ref to one is a back edge
  const inProgress = new Set<string>()

  const noteUnpublished = (propertyKey: string, modelName: string | undefined, seed: { seedLocalId: string; seedUid: string; type?: string | null }) => {
    if (graph.unpublishedRelatedItems.some((r) => r.propertyName === propertyKey && r.seedLocalId === seed.seedLocalId)) return
    graph.unpublishedRelatedItems.push({
      propertyName: propertyKey,
      modelName: modelName ?? seed.type ?? 'unknown',
      seedLocalId: seed.seedLocalId,
      seedUid: seed.seedUid,
    })
  }

  const link = (target: PublishGraphNode, owner: PublishGraphNode, propertyKey: string) => {
    if (!target.links.some((l) => l.seedLocalId === owner.seedLocalId && l.propertyKey === propertyKey)) {
      target.links.push({ seedLocalId: owner.seedLocalId, propertyKey })
    }
  }

  /**
   * Follows one ref of `property`: a draft target becomes a node (walked now, or already in the
   * graph). Returns the ref with its node, or undefined for a back edge.
   */
  const follow = async (
    owner: PublishGraphNode,
    property: PublishGraphProperty,
    ref: string,
  ): Promise<PublishGraphRef | 'backEdge'> => {
    const list = property.kind === 'list'
    const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(ref)
    if (!seedLocalId && !seedUid) {
      graph.brokenRefs.push({ seedLocalId: owner.seedLocalId, propertyKey: property.key, ref, reason: 'invalid', list })
      return { ref }
    }
    const row = await findRelatedSeedRow({ seedLocalId, seedUid })
    const targetLocalId = row?.seedLocalId ?? seedLocalId
    if (property.kind !== 'storageSeed' && targetLocalId && inProgress.has(targetLocalId)) return 'backEdge'
    if (isUnpublishedSeed(row)) {
      const targetNode = nodes.get(row.seedLocalId)
      noteUnpublished(property.key, targetNode?.modelName ?? relatedModelNameFromDef(property.definition), row)
      return { ref, seedLocalId: row.seedLocalId }
    }
    if (isLivePublishedSeed(row)) {
      if (ref !== row.seedUid) graph.relatedRefUids.set(ref, row.seedUid)
      return { ref, seedLocalId: row.seedLocalId }
    }
    if (!row) {
      // An attested uid with no local copy is already published: attested as-is
      if (!isPublishedSeedRef(ref)) {
        graph.brokenRefs.push({ seedLocalId: owner.seedLocalId, propertyKey: property.key, ref, reason: 'missing', list })
      }
      return { ref, seedLocalId }
    }
    let node = nodes.get(row.seedLocalId)
    if (!node) {
      const kind = property.kind === 'storageSeed' ? 'storageSeed' : 'draft'
      node = await readNode(row.seedLocalId, kind, relatedModelNameFromDef(property.definition))
      if (!node) {
        graph.brokenRefs.push({ seedLocalId: owner.seedLocalId, propertyKey: property.key, ref, reason: 'missing', list })
        return { ref, seedLocalId: row.seedLocalId }
      }
      nodes.set(node.seedLocalId, node)
      await visit(node)
    }
    return { ref, seedLocalId: node.seedLocalId, node }
  }

  const walkProperty = async (owner: PublishGraphNode, property: PublishGraphProperty) => {
    const refs = refsOf(property.row?.propertyValue, property.kind)
    property.walked = refs.length > 0 && (!property.uid || forceFullSnapshot)
    if (!property.walked) return
    // A list member that is a back edge defers the whole list; its other drafts are still published
    const followed: PublishGraphRef[] = []
    for (const ref of refs) {
      const result = await follow(owner, property, ref)
      if (result === 'backEdge') {
        property.deferred = true
        if (property.kind !== 'list') return
        continue
      }
      followed.push(result)
    }
    property.refs = followed
    if (property.deferred) return
    for (const { node } of followed) if (node) link(node, owner, property.key)
  }

  const walkEmbeddedImages = async (owner: PublishGraphNode) => {
    const done = new Set<string>()
    for (const row of owner.embeddedImages) {
      if (done.has(row.imageSeedLocalId)) continue
      done.add(row.imageSeedLocalId)
      const seed = await findRelatedSeedRow({ seedLocalId: row.imageSeedLocalId })
      if (isUnpublishedSeed(seed)) {
        noteUnpublished(htmlPropertyForHtmlSeed(owner, row.htmlSeedLocalId)?.key ?? 'html', 'Image', seed)
        continue
      }
      if (isLivePublishedSeed(seed)) continue
      if (!seed) {
        graph.missingEmbeddedImages.push({ seedLocalId: owner.seedLocalId, imageSeedLocalId: row.imageSeedLocalId })
        continue
      }
      if (nodes.has(seed.seedLocalId)) continue
      const node = await readNode(seed.seedLocalId, 'embeddedImage', 'Image')
      if (!node) {
        graph.missingEmbeddedImages.push({ seedLocalId: owner.seedLocalId, imageSeedLocalId: row.imageSeedLocalId })
        continue
      }
      nodes.set(node.seedLocalId, node)
      graph.nodes.push(node)
    }
  }

  async function visit(node: PublishGraphNode): Promise<void> {
    const full = node.kind === 'root' || node.kind === 'draft'
    if (node.newSeed) inProgress.add(node.seedLocalId)
    try {
      if (full) {
        for (const property of node.properties) {
          if (property.kind === 'relation' || property.kind === 'storageSeed') await walkProperty(node, property)
        }
        await walkEmbeddedImages(node)
        for (const property of node.properties) {
          if (property.kind === 'list') await walkProperty(node, property)
        }
      }
    } finally {
      inProgress.delete(node.seedLocalId)
    }
    graph.nodes.push(node)
  }

  await visit(rootNode)
  return graph
}

/** Nodes of `graph` that are full items (the root and model drafts): the owners of Html properties and embedded images. */
export const publishGraphItemNodes = (graph: PublishGraph): PublishGraphNode[] =>
  graph.nodes.filter((n) => n.kind === 'root' || n.kind === 'draft')
