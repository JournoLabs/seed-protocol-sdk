import {
  decodeEasNumber,
  easName,
  getEasSchemaUidForSchemaDefinition,
  getSchemaUidForSchemaDefinitionFromCache,
} from '@seedprotocol/eas'
import {
  defaultAttestationData,
  INTERNAL_DATA_TYPES,
  INTERNAL_PROPERTY_NAMES,
  VERSION_SCHEMA_UID,
  ZERO_BYTES32,
} from '@/helpers/constants'
import type {
  AttestationRequest,
  AttestationRequestData,
} from '@ethereum-attestation-service/eas-sdk'
import { loadEasSdk } from '@/helpers/easSdk'
import { getEasSchemaUidForModel } from './getSchemaUidForModel'
import { emptyEasValue, getPropertyClear } from '@/db/read/getPropertyClear'
import { isStorageSeedRef } from '@/helpers/relationSeedRef'
import {
  easPropertyNameForPublish,
  listRelationEasPropertyName,
  metadataStorageName,
} from '@/helpers/metadataPropertyNames'
import { encodeBytes32String } from '@/helpers/ethereumUtils'
import { ModelPropertyDataTypes, normalizeDataType } from '@/Schema'
import {
  PublishValidationFailedError,
  RelatedItemUnpublishedError,
  type PublishValidationError,
} from '@/db/read/publishErrors'
import {
  getPublishGraph,
  htmlPropertyForHtmlSeed,
  type PublishGraph,
  type PublishGraphNode,
  type PublishGraphProperty,
  type PublishMode,
} from '@/db/read/publishGraph'

export { PublishValidationFailedError, type PublishValidationError }
export type { PublishMode }

export type GetPublishPayloadOptions = {
  /** `patch` (default): new property attestations on the current Version. `new_version`: new Version attestation + attest all properties. */
  publishMode?: PublishMode
}

type Attestation = Omit<AttestationRequest, 'data'> & {
  data: AttestationRequestData[]
  /** The property's schema key. */
  _propertyName?: string
  /** Metadata row the attested value was read from: recording gives the uid to exactly that row. */
  _metadataLocalId?: string
  /** A value that is not in that row yet (the storage transaction id of this publish's upload), for recording to store. */
  _attestedValue?: string
  /** Same as encode step (getPropertyData); resolvePublishPayloadValues must use this, not easName(propertyName). */
  _propertyNameForSchema?: string
  _schemaDef?: string
  _unresolvedValue?: string
  _easDataType?: string
  /** Per-slot raw ids (local or 0x) before encodeBytes32String; re-encoded after sequential publish. */
  _rawListIdsForResolve?: string[]
}

type PublishPayload = {
  localId: string
  /** The version row this request's Version attestation is recorded on (none when it attests under an existing version). */
  versionLocalId?: string
  seedIsRevocable: boolean
  seedSchemaUid: string
  seedUid: string
  versionSchemaUid: string
  versionUid: string
  listOfAttestations: Attestation[]
  propertiesToUpdate: { publishLocalId: string; propertySchemaUid: string }[]
}

type MultiPublishPayload = PublishPayload[]

/** Map of seed localId -> attestation uid for resolving relation/image property values after dependent seeds are published */
export type ResolvedSeedUids = Record<string, string>

type UploadedTransaction = {
  txId: string
  itemPropertyLocalId?: string
  seedLocalId?: string
  versionLocalId?: string
  itemPropertyName?: string
}

type BuildContext = {
  graph: PublishGraph
  errors: PublishValidationError[]
  uploadedTransactions: UploadedTransaction[]
}

const matchesDataType = (
  actual: string | undefined,
  expected: ModelPropertyDataTypes | string,
): boolean => normalizeDataType(actual) === expected

/**
 * An EAS uid (0x + 64 hex), as opposed to a local id. A "0x" prefix alone doesn't tell them apart:
 * local ids are random alphanumerics, and about 1 in 3,844 starts with "0x".
 */
function isUidRef(ref: string): boolean {
  return ref.length === 66 && ref.startsWith('0x')
}

function addValidationError(ctx: BuildContext, message: string, field?: string, code = 'publish_validation'): void {
  if (ctx.errors.some((e) => e.message === message && e.field === (field ?? ''))) return
  ctx.errors.push({ field: field ?? '', message, code })
}

/** Current uid for a ref to a live published seed, else the ref itself. */
const currentRelatedRef = (ctx: BuildContext, ref: string): string => ctx.graph.relatedRefUids.get(ref.trim()) ?? ref

const uploadedTxFor = (ctx: BuildContext, seedLocalId: string): UploadedTransaction | undefined =>
  ctx.uploadedTransactions.find((u) => u.seedLocalId?.trim() === seedLocalId)

type PropertyDataResult = {
  schemaUid: string
  easDataType: string
  schemaDef: string
  propertyNameForSchema: string
}

/** The EAS schema a property attests under. Reports an error and returns null when there is none. */
const getPropertyData = async (
  property: PublishGraphProperty,
  ctx: BuildContext,
): Promise<PropertyDataResult | null> => {
  const { key, definition } = property
  const rawDataType = definition.dataType
  const dataType = rawDataType ? normalizeDataType(String(rawDataType)) : undefined
  const easDataType = dataType ? INTERNAL_DATA_TYPES[dataType as keyof typeof INTERNAL_DATA_TYPES]?.eas : undefined
  if (!easDataType) {
    addValidationError(
      ctx,
      `Unknown or unsupported property data type "${rawDataType ?? 'undefined'}" for property: ${key}. Supported types: ${Object.keys(INTERNAL_DATA_TYPES).join(', ')}.`,
      key,
    )
    return null
  }

  // ADR 0008: list relations publish under their storage name (authors → author_identity_ids),
  // single relations under their schema key (author), never the local authorId.
  const listRelationName = listRelationEasPropertyName(key, definition)
  const propertyNameForSchema = easPropertyNameForPublish(key, definition)
  const schemaDef = `${easDataType} ${propertyNameForSchema}`

  // The UID ensureEasSchemasForItem resolved for this exact definition comes first. A row's
  // schemaUid was looked up under the property's own name, which matches any type: Optimism
  // Sepolia has `bytes32 storage_transaction_id` beside `string storage_transaction_id`, and
  // attesting a string under the bytes32 one reads back as 0x…20. Trust the row's only when
  // that name is the one published (not for a list relation, or a single relation stored as authorId).
  const storageName = metadataStorageName(key, definition)
  let schemaUid: string | undefined =
    getSchemaUidForSchemaDefinitionFromCache(schemaDef) ??
    (!listRelationName && easName(storageName) === propertyNameForSchema ? property.row?.schemaUid ?? undefined : undefined)
  if (!schemaUid) {
    schemaUid = await getEasSchemaUidForSchemaDefinition({ schemaText: schemaDef })
  }
  if (!schemaUid) {
    addValidationError(
      ctx,
      `EAS schema not found for "${schemaDef}" (property: ${key}). Register it before publishing (ensureEasSchemasForItem).`,
      key,
      'publish_schema_not_found',
    )
    return null
  }
  return { schemaUid, easDataType, schemaDef, propertyNameForSchema }
}

/** The label a required-value error uses for a relation or storage-seed property. */
function refTypeLabel(definition: PublishGraphProperty['definition']): string {
  for (const [type, label] of [
    [ModelPropertyDataTypes.File, 'file'],
    [ModelPropertyDataTypes.Image, 'image'],
    [ModelPropertyDataTypes.Html, 'html'],
    [ModelPropertyDataTypes.Json, 'json'],
  ] as const) {
    if (matchesDataType(definition.dataType, type) || matchesDataType(definition.refValueType, type)) return label
  }
  return 'relation'
}

/** Required relation and storage-seed properties need a value pointing at an item. */
function checkRequiredRef(node: PublishGraphNode, property: PublishGraphProperty, ctx: BuildContext): void {
  const { key, definition } = property
  if (definition.required !== true) return
  const value = property.row?.propertyValue
  const refLabel = definition.ref ?? definition.refModelName ?? 'related'
  if (value == null || value.trim() === '') {
    addValidationError(
      ctx,
      `Required ${refTypeLabel(definition)} ${key} has no value. A value pointing to a valid ${refLabel} item is required to publish.`,
      key,
    )
    return
  }
  for (const broken of ctx.graph.brokenRefs) {
    if (broken.seedLocalId !== node.seedLocalId || broken.propertyKey !== key || broken.list) continue
    addValidationError(
      ctx,
      broken.reason === 'invalid'
        ? `Required relation ${key} has invalid value: ${JSON.stringify(value)}. ` +
            `Value must be a valid seed reference (localId or uid) pointing to a ${refLabel} item.`
        : `No related item found for required relation: ${key}. Value: ${JSON.stringify(value)} (seedLocalId/seedUid). ` +
            `The related item may be missing, in a different database, or the reference may be broken.`,
      key,
    )
  }
}

/** A Boolean row value as stored ("true"/"false", "1"/"0"). */
const booleanFromRow = (value: string): boolean | string =>
  value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : value

/**
 * Whether publishing `property` of `node` with an empty value attests a removal. 0 and false are
 * values (ADR 0010). An empty value publishes only as a removal of a value attested before
 * (ADR 0021); a retraction attests nothing (publish revokes instead).
 */
export async function publishRemovesValue(
  node: Pick<PublishGraphNode, 'seedLocalId' | 'seedUid' | 'modelName'>,
  property: Pick<PublishGraphProperty, 'key' | 'definition'>,
): Promise<boolean> {
  const { key, definition } = property
  const clear = await getPropertyClear({
    seedLocalId: node.seedLocalId,
    seedUid: node.seedUid,
    propertyId: definition._dbId,
    modelName: node.modelName,
    propertyName: key,
    dataType: definition.dataType,
    refValueType: definition.refValueType,
  })
  return !!clear && !clear.retract
}

/**
 * The attestation of one property of `node`, or undefined when the publish leaves it out (no
 * value, already attested in patch mode, deferred, invalid: the last reports an error).
 */
async function attestProperty(
  node: PublishGraphNode,
  property: PublishGraphProperty,
  versionUid: string,
  ctx: BuildContext,
): Promise<Attestation | undefined> {
  const { key, definition, row } = property
  const forceFullSnapshot = ctx.graph.forceFullSnapshot
  if (INTERNAL_PROPERTY_NAMES.includes(key) || property.deferred) return undefined

  const isFileImageHtml =
    matchesDataType(definition.dataType, ModelPropertyDataTypes.File) ||
    matchesDataType(definition.dataType, ModelPropertyDataTypes.Image) ||
    matchesDataType(definition.dataType, ModelPropertyDataTypes.Html)
  const isRef = property.kind === 'relation' || property.kind === 'storageSeed'
  const isStorageTransaction = property.kind === 'storageTransaction'

  // The storage transaction slot attests this publish's upload of the node's file(s).
  const uploaded = isStorageTransaction ? uploadedTxFor(ctx, node.seedLocalId) : undefined
  if (isStorageTransaction && !uploaded) return undefined
  let value: unknown = uploaded ? uploaded.txId : row?.propertyValue

  let isRemoval = false
  if (value == null || value === '') {
    if (property.uid && !forceFullSnapshot) return undefined
    if (!(await publishRemovesValue(node, property))) return undefined
    isRemoval = true
  }
  // Patch mode skips properties that already have an EAS uid, except a storage transaction this
  // publish uploaded.
  if (!isRemoval && property.uid && !forceFullSnapshot && !uploaded) return undefined

  // File/Image/Html values must be a storage seed id by now. Raw content means the property's
  // save pipeline never ran or failed (e.g. createNewItem with raw html), so it was never uploaded.
  if (!isRemoval && isFileImageHtml && typeof value === 'string' && !isStorageSeedRef(value.trim())) {
    addValidationError(
      ctx,
      `Invalid value for property: ${key}. Expected a storage seed id ` +
        `(${normalizeDataType(definition.dataType)} content must be saved through the property before publishing), ` +
        `got ${value.length > 40 ? `${value.slice(0, 40)}…` : value}.`,
      key,
      'publish_storage_value_not_saved',
    )
    return undefined
  }

  const propertyData = await getPropertyData(property, ctx)
  if (!propertyData) return undefined
  const { schemaUid, easDataType, schemaDef, propertyNameForSchema } = propertyData
  const isList = schemaDef.startsWith('bytes32[]')

  let rawListIdsForResolve: string[] | undefined
  if (isRemoval) {
    const empty = emptyEasValue(easDataType)
    if (empty === undefined) {
      addValidationError(
        ctx,
        `${key} can't be published empty: ${definition.dataType ?? easDataType} properties have no empty value. Clear it with clear({ retract: true }).`,
        key,
        'publish_clear_unsupported',
      )
      return undefined
    }
    value = empty
  } else {
    if (typeof value === 'string' && isRef) value = currentRelatedRef(ctx, value.trim())
    if (isList && typeof value === 'string') {
      const text = value.trim()
      if (text.startsWith('[')) {
        try {
          value = JSON.parse(text)
        } catch {
          // reported below
        }
      } else if (text.includes(',')) {
        // Legacy comma-separated ids (pre-JSON List storage)
        value = text.split(',').map((s) => s.trim()).filter(Boolean)
      }
    }
    if (isList && !Array.isArray(value)) {
      addValidationError(ctx, `Invalid value for property: ${key}. Expected an array of bytes32, got ${value}.`, key)
      return undefined
    }
    if (easDataType === 'bool' && typeof value === 'string') value = booleanFromRow(value.trim())

    // Validate against property validation rules (enum, pattern, minLength, maxLength) before encoding
    if (definition.validation) {
      const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
      const result = new SchemaValidationService().validatePropertyValue(
        value,
        normalizeDataType(definition.dataType) as ModelPropertyDataTypes,
        definition.validation,
        definition.refValueType ? (normalizeDataType(definition.refValueType) as string) : undefined,
      )
      if (!result.isValid && result.errors.length > 0) {
        const firstError = result.errors[0]!
        addValidationError(ctx, firstError.message, key, firstError.code ?? 'publish_validation')
        return undefined
      }
    }

    if (isList) {
      const encoded: string[] = []
      const rawIds: string[] = []
      for (const member of value as unknown[]) {
        const id = typeof member === 'string' ? member.trim() : ''
        if (!id) continue
        const ref = currentRelatedRef(ctx, id)
        rawIds.push(ref)
        encoded.push(isUidRef(ref) ? ref : encodeBytes32String(ref))
      }
      value = encoded
      if (rawIds.some((id) => !isUidRef(id))) rawListIdsForResolve = rawIds
    }

    // uint256 (Date) must be numeric/BigInt; normalize ISO strings to Unix seconds
    if (easDataType === 'uint256' && (typeof value === 'string' || value instanceof Date)) {
      const ms = value instanceof Date ? value.getTime() : /^\d+$/.test(value) ? Number(value) : new Date(value).getTime()
      value = BigInt(Math.floor(ms / 1000))
    }

    // ADR 0010: Number attests as its decimal string, in the form readers decode it to.
    if (matchesDataType(definition.dataType, ModelPropertyDataTypes.Number)) {
      const decimal = decodeEasNumber(value)
      if (decimal === undefined) {
        addValidationError(
          ctx,
          `Invalid value for property: ${key}. Expected a finite number, got ${JSON.stringify(value)}.`,
          key,
          'publish_invalid_number',
        )
        return undefined
      }
      value = decimal
    }
  }

  let encodedData: string
  try {
    const { SchemaEncoder } = await loadEasSdk()
    encodedData = new SchemaEncoder(schemaDef).encodeData([
      { name: propertyNameForSchema, type: easDataType, value: value as any },
    ]) as string
  } catch (encodeErr) {
    addValidationError(
      ctx,
      `Failed to encode property ${key}: ${encodeErr instanceof Error ? encodeErr.message : String(encodeErr)}`,
      key,
    )
    return undefined
  }

  const attestation: Attestation = {
    schema: schemaUid,
    data: [
      {
        ...defaultAttestationData,
        // The storage transaction references the Version attestation (contract may use when supported)
        refUID: isStorageTransaction ? versionUid : defaultAttestationData.refUID,
        data: encodedData,
      } as AttestationRequestData,
    ],
    _propertyName: key,
    ...(row?.localId ? { _metadataLocalId: row.localId } : {}),
    ...(uploaded && uploaded.txId !== row?.propertyValue ? { _attestedValue: uploaded.txId } : {}),
  }

  // Refs to seeds of this publish by local id: resolution hints for resolvePublishPayloadValues
  if (
    typeof value === 'string' &&
    !isUidRef(value) &&
    /^[a-zA-Z0-9_-]{10,21}$/.test(value.trim()) &&
    (easDataType === 'bytes32' || easDataType === 'string')
  ) {
    attestation._propertyNameForSchema = propertyNameForSchema
    attestation._schemaDef = schemaDef
    attestation._unresolvedValue = value.trim()
    attestation._easDataType = easDataType
  }
  if (rawListIdsForResolve?.length) {
    attestation._propertyNameForSchema = propertyNameForSchema
    attestation._schemaDef = schemaDef
    attestation._easDataType = 'bytes32[]'
    attestation._rawListIdsForResolve = rawListIdsForResolve
  }
  return attestation
}

/** The order a node's properties attest in: basic values, its upload, refs, lists. */
const ATTEST_ORDER: PublishGraphProperty['kind'][] = ['basic', 'storageTransaction', 'relation', 'storageSeed', 'list']

/** One node's request: its seed, version and property attestations, and the parent properties its seed uid fills. */
async function buildRequest(node: PublishGraphNode, ctx: BuildContext): Promise<PublishPayload> {
  const { graph } = ctx
  const isRoot = node.kind === 'root'
  // A storage seed or an embedded image attests its own basic properties only.
  const full = isRoot || node.kind === 'draft'
  const reportField = node.links[0]?.propertyKey

  let seedSchemaUid = isRoot ? node.seedSchemaUid : undefined
  seedSchemaUid ??= (await getEasSchemaUidForModel(node.modelName)) ?? undefined
  if (!seedSchemaUid) addValidationError(ctx, `Schema UID not found for model: ${node.modelName}`, isRoot ? undefined : reportField)

  let versionUid = node.version.uid ?? (node.newSeed ? undefined : node.version.publishedUid) ?? ZERO_BYTES32
  if (isRoot && graph.forceFullSnapshot && node.seedUid) versionUid = ZERO_BYTES32
  const versionLocalId = versionUid === ZERO_BYTES32 && !node.version.uid ? node.version.localId : undefined

  const request: PublishPayload = {
    localId: node.seedLocalId,
    ...(versionLocalId ? { versionLocalId } : {}),
    seedIsRevocable: true,
    seedSchemaUid: seedSchemaUid ?? ZERO_BYTES32,
    seedUid: node.newSeed || !node.seedUid ? ZERO_BYTES32 : node.seedUid,
    versionSchemaUid: VERSION_SCHEMA_UID,
    versionUid,
    listOfAttestations: [],
    propertiesToUpdate: [],
  }

  for (const kind of ATTEST_ORDER) {
    for (const property of node.properties) {
      if (property.kind !== kind) continue
      if (!full && kind !== 'basic' && kind !== 'storageTransaction') continue
      if (full && (kind === 'relation' || kind === 'storageSeed')) checkRequiredRef(node, property, ctx)
      const attestation = await attestProperty(node, property, versionUid, ctx)
      if (attestation) request.listOfAttestations.push(attestation)
    }
  }

  // Each property this seed's uid fills: the contract writes the uid into that attestation.
  for (const { seedLocalId, propertyKey } of node.links) {
    const owner = graph.nodes.find((n) => n.seedLocalId === seedLocalId)
    const property = owner?.properties.find((p) => p.key === propertyKey)
    if (!property) continue
    const propertySchemaUid = (await getPropertyData(property, ctx))?.schemaUid
    if (!propertySchemaUid) continue
    if (!request.propertiesToUpdate.some((u) => u.publishLocalId === seedLocalId && u.propertySchemaUid.toLowerCase() === propertySchemaUid.toLowerCase())) {
      request.propertiesToUpdate.push({ publishLocalId: seedLocalId, propertySchemaUid })
    }
  }
  return request
}

/**
 * Embedded image rows must still name an Html value of their owner, with a schema to attest under.
 * No propertiesToUpdate: the Html refers to the image by its Arweave URL (the data URI is
 * rewritten to it before the Html is uploaded), not by seed uid.
 */
async function checkEmbeddedImages(ctx: BuildContext): Promise<void> {
  const { graph } = ctx
  for (const owner of graph.nodes) {
    for (const row of owner.embeddedImages) {
      const imageNode = graph.nodes.find((n) => n.seedLocalId === row.imageSeedLocalId && n.kind === 'embeddedImage')
      const missing = graph.missingEmbeddedImages.some((m) => m.imageSeedLocalId === row.imageSeedLocalId)
      if (!imageNode && !missing) continue
      const html = htmlPropertyForHtmlSeed(owner, row.htmlSeedLocalId)
      if (!html) {
        addValidationError(ctx, `Could not find Html property for embedded image rewrite (html seed ${row.htmlSeedLocalId.trim()}).`, 'html', 'html_embed_schema')
        continue
      }
      if (!(await getPropertyData(html, ctx))) continue
      if (missing) {
        addValidationError(ctx, `Embedded Image item not found for seed ${row.imageSeedLocalId}.`, 'html', 'html_embed_image_missing')
      }
    }
  }
}

export const getPublishPayload = async (
  item: { seedLocalId: string; modelName?: string },
  uploadedTransactions: UploadedTransaction[],
  options?: GetPublishPayloadOptions,
): Promise<MultiPublishPayload> => {
  const publishMode: PublishMode = options?.publishMode ?? 'patch'
  const graph = await getPublishGraph(item, { publishMode })
  const ctx: BuildContext = { graph, errors: [], uploadedTransactions }

  if (publishMode === 'new_version' && !graph.root.seedUid) {
    addValidationError(
      ctx,
      'Publishing as a new version requires the item to already have a published Seed attestation (seed UID).',
      'seedUid',
      'publish_new_version_requires_seed',
    )
  }

  let multiPublishPayload: MultiPublishPayload = []
  for (const node of graph.nodes) multiPublishPayload.push(await buildRequest(node, ctx))
  await checkEmbeddedImages(ctx)

  // A request whose seed fills another request's property (propertiesToUpdate) publishes first, and a
  // request encoding another's local id publishes after it.
  multiPublishPayload = orderPayloadByDependencies(multiPublishPayload)

  if (publishMode === 'new_version') {
    const rootPayload = multiPublishPayload.find((p) => p.localId === graph.root.seedLocalId)
    if (!rootPayload?.listOfAttestations.length) {
      addValidationError(
        ctx,
        'Publishing as a new version requires at least one property attestation for the item. ' +
          'Ensure required fields have values and that publishable properties are present.',
        'listOfAttestations',
        'publish_new_version_empty_snapshot',
      )
    }
  }

  // Stop before anything is uploaded or attested: the payload would attest revoked seed uids.
  if (graph.unpublishedRelatedItems.length) {
    throw new RelatedItemUnpublishedError(graph.unpublishedRelatedItems, ctx.errors)
  }

  if (ctx.errors.length > 0) {
    const combinedMessage = ctx.errors.map((e) => e.message).join('\n')
    throw new PublishValidationFailedError(
      `Validation failed (${ctx.errors.length} error${ctx.errors.length === 1 ? '' : 's'}):\n${combinedMessage}`,
      ctx.errors,
    )
  }

  return multiPublishPayload
}

export type ValidateItemForPublishResult = {
  isValid: boolean
  errors: PublishValidationError[]
}

/**
 * Validates an item for publishing without performing Arweave or EAS work.
 * Use in the checking step to fail fast before creating transactions.
 * Pass empty array for uploadedTransactions when validating before Arweave upload.
 */
export const validateItemForPublish = async (
  item: { seedLocalId: string; modelName?: string },
  uploadedTransactions: UploadedTransaction[] = [],
  options?: GetPublishPayloadOptions,
): Promise<ValidateItemForPublishResult> => {
  try {
    await getPublishPayload(item, uploadedTransactions, options)
    return { isValid: true, errors: [] }
  } catch (err) {
    if (err instanceof PublishValidationFailedError) {
      return { isValid: false, errors: err.validationErrors }
    }
    throw err
  }
}

/**
 * LocalIds in this batch referenced by attestations (bytes32 / bytes32[]) that must publish before this request.
 */
function collectAttestationLocalRefIds(req: PublishPayload, allLocalIds: Set<string>): string[] {
  const refs: string[] = []
  for (const att of req.listOfAttestations) {
    if (att._unresolvedValue && allLocalIds.has(att._unresolvedValue)) refs.push(att._unresolvedValue)
    for (const id of att._rawListIdsForResolve ?? []) {
      const t = id != null ? String(id).trim() : ''
      if (t && allLocalIds.has(t)) refs.push(t)
    }
  }
  return refs
}

/**
 * Topological sort (Kahn): edge `from → to` means `from` must publish before `to`.
 * - propertiesToUpdate: updater before updatee (contract injection).
 * - _unresolvedValue / _rawListIdsForResolve: referenced seed before request that encodes the ref.
 * Ties keep the input order (the graph's finish order).
 */
function orderPayloadByDependencies(payload: MultiPublishPayload): MultiPublishPayload {
  if (payload.length <= 1) return payload

  const byLocalId = new Map<string, PublishPayload>()
  const indexOrder = new Map<string, number>()
  payload.forEach((p, i) => {
    byLocalId.set(p.localId, p)
    indexOrder.set(p.localId, i)
  })
  const allIds = new Set(byLocalId.keys())
  const indegree = new Map<string, number>([...allIds].map((id) => [id, 0]))
  const adj = new Map<string, Set<string>>()

  const addEdge = (from: string, to: string) => {
    if (from === to || !allIds.has(from) || !allIds.has(to)) return
    if (!adj.has(from)) adj.set(from, new Set())
    const set = adj.get(from)!
    if (set.has(to)) return
    set.add(to)
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }

  for (const p of payload) {
    for (const u of p.propertiesToUpdate) addEdge(p.localId, u.publishLocalId)
    for (const refId of collectAttestationLocalRefIds(p, allIds)) addEdge(refId, p.localId)
  }

  const byInputOrder = (a: string, b: string) => (indexOrder.get(a) ?? 0) - (indexOrder.get(b) ?? 0)
  const queue = [...allIds].filter((id) => (indegree.get(id) ?? 0) === 0).sort(byInputOrder)
  const result: PublishPayload[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(byLocalId.get(id)!)
    for (const to of adj.get(id) ?? []) {
      const next = (indegree.get(to) ?? 0) - 1
      indegree.set(to, next)
      if (next === 0) {
        queue.push(to)
        queue.sort(byInputOrder)
      }
    }
  }

  if (result.length !== payload.length) {
    const seen = new Set(result.map((r) => r.localId))
    for (const p of payload) if (!seen.has(p.localId)) result.push(p)
  }
  return result
}

/** Normalize attestation UID to 32-byte hex for SchemaEncoder bytes32 fields. */
function padUidForBytes32Schema(uid: string): string {
  const t = uid.trim()
  if (!t.startsWith('0x')) return uid
  const hex = t.slice(2).replace(/[^0-9a-fA-F]/g, '')
  if (hex.length === 0) return uid
  return ('0x' + hex.padStart(64, '0').slice(-64)).toLowerCase()
}

/**
 * Resolves relation/image property values (seedLocalId) to attestation uids after dependent seeds are published.
 * Call after each payload is published, passing the returned attestation uid for that seed's localId.
 * Returns an updated multiPayload with re-encoded attestations where resolution was applied.
 */
export const resolvePublishPayloadValues = async (
  multiPayload: MultiPublishPayload,
  resolvedUids: ResolvedSeedUids,
): Promise<MultiPublishPayload> => {
  if (Object.keys(resolvedUids).length === 0) {
    return multiPayload
  }

  const { SchemaEncoder } = await loadEasSdk()
  const result: MultiPublishPayload = []

  for (const payload of multiPayload) {
    const updatedAttestations: PublishPayload['listOfAttestations'] = []

    for (const attestation of payload.listOfAttestations) {
      const entry = attestation as Attestation & { data?: AttestationRequestData[] | AttestationRequestData }

      const rawList = entry._rawListIdsForResolve
      if (
        rawList &&
        rawList.length > 0 &&
        entry._schemaDef &&
        (entry._propertyNameForSchema || entry._propertyName)
      ) {
        const fieldName =
          entry._propertyNameForSchema ?? easName(entry._propertyName as string)
        const resolvedValues: string[] = []
        let allSlotsResolved = true
        for (const id of rawList) {
          const trimmed = id.trim()
          if (isUidRef(trimmed)) {
            resolvedValues.push(padUidForBytes32Schema(trimmed))
            continue
          }
          const r = resolvedUids[trimmed]
          if (r) {
            resolvedValues.push(padUidForBytes32Schema(r))
            continue
          }
          allSlotsResolved = false
          break
        }
        // Do not encode or clear hints until every slot has a real uid — otherwise sequential
        // publish burns encodeBytes32String(localId) into data and drops _rawListIdsForResolve.
        if (!allSlotsResolved) {
          updatedAttestations.push({
            ...entry,
            data: Array.isArray(entry.data) ? entry.data : [entry.data as AttestationRequestData],
          })
          continue
        }
        const dataEncoder = new SchemaEncoder(entry._schemaDef)
        const encodedData = dataEncoder.encodeData([
          {
            name: fieldName,
            type: 'bytes32[]',
            value: resolvedValues,
          },
        ])
        const baseData = Array.isArray(entry.data) ? entry.data[0] : (entry.data as AttestationRequestData)
        updatedAttestations.push({
          ...entry,
          data: [
            {
              ...baseData,
              data: encodedData,
            } as AttestationRequestData,
          ],
          _rawListIdsForResolve: undefined,
          _easDataType: undefined,
        })
        continue
      }

      const resolvedUid = entry._unresolvedValue && resolvedUids[entry._unresolvedValue]
      const easType = (entry._easDataType as 'bytes32' | 'string') || 'bytes32'
      if (resolvedUid && entry._schemaDef && (entry._propertyNameForSchema || entry._propertyName)) {
        const fieldName =
          entry._propertyNameForSchema ?? easName(entry._propertyName as string)
        const valueForEncode =
          easType === 'bytes32' ? padUidForBytes32Schema(resolvedUid) : resolvedUid
        const dataEncoder = new SchemaEncoder(entry._schemaDef)
        const encodedData = dataEncoder.encodeData([
          {
            name: fieldName,
            type: easType,
            value: valueForEncode,
          },
        ])
        const baseData = Array.isArray(entry.data) ? entry.data[0] : (entry.data as AttestationRequestData)
        updatedAttestations.push({
          ...entry,
          data: [
            {
              ...baseData,
              data: encodedData,
            } as AttestationRequestData,
          ],
          _unresolvedValue: undefined,
        })
      } else {
        const normalizedEntry: PublishPayload['listOfAttestations'][0] = {
          ...entry,
          data: Array.isArray(entry.data) ? entry.data : [entry.data as AttestationRequestData],
        }
        updatedAttestations.push(normalizedEntry)
      }
    }

    result.push({
      ...payload,
      listOfAttestations: updatedAttestations,
    })
  }

  return result
}
