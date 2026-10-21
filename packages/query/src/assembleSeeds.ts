import {
  decodeEasNumber,
  isEasEmptyValue,
  isNumericEasType,
  setSchemaUidForSchemaDefinition,
  pickLatestPropertyAttestationsByRefAndSchema,
  keepAttestationsFromRefAttester,
} from '@seedprotocol/eas'
import { getArweaveUrlForTransaction } from './arweaveUrl.js'
import {
  publicListRelationPropertyKey,
  stripListRelationStorageAliasesForPublicKey,
  tryCoerceJsonStringArray,
} from './listRelationKey.js'
import { enrichImageSeedClone } from './imageRelationEnrichment.js'
import { hydrateArweaveRichTextInItems } from './hydrateArweaveRichText.js'
import { parseEasPropertyMetadata } from './parseEasPropertyMetadata.js'
import { parseEasRelationPropertyName } from './parseEasRelationPropertyName.js'
import {
  setFieldStorageModel,
  setListElementStorageModels,
} from './fieldStorageModel.js'
import { getRemoteQueryDataSource } from './source/remote.js'
import type { QueryDataSource } from './source/types.js'
import {
  relationsModeOf,
  type AssembleOptions,
  type AttestationLike,
  type SeedRecord,
  type VersionPin,
} from './types.js'

const IMAGE_SCHEMA = 'image'

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]

const RESERVED_KEYS = new Set([
  'seedUid',
  'SeedUid',
  'timeCreated',
  'attester',
  'Attester',
  'storage_transaction_id',
  'storage_provider_transaction_id',
  'storageTransactionId',
  'storageProviderTransactionId',
  'versionUid',
])

const toCamelCase = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

type AssembleContext = {
  seedUidToModelType: Map<string, string>
  relatedSeedUids: Set<string>
  /** Related seeds each seed's properties name (what its record depends on besides itself). */
  relatedSeedUidsBySeedUid: Map<string, Set<string>>
  versionUidToSeedUid: Map<string, string>
  assembledItems: Map<string, Record<string, unknown>>
  versionsBySeedUid: Map<string, AttestationLike[]>
  latestVersionUidsBySeedUid: Map<string, string>
  /** Requested seeds left out because every version is revoked; not fetched again as related. */
  droppedSeedUids: Set<string>
  /**
   * The seeds asked for, in order. Only these become records: a related seed is fetched to expand
   * relations into, even when it has the requested schema.
   */
  requestedSeedUids: Set<string>
}

function createAssembleContext(): AssembleContext {
  return {
    seedUidToModelType: new Map(),
    relatedSeedUids: new Set(),
    relatedSeedUidsBySeedUid: new Map(),
    versionUidToSeedUid: new Map(),
    assembledItems: new Map(),
    versionsBySeedUid: new Map(),
    latestVersionUidsBySeedUid: new Map(),
    droppedSeedUids: new Set(),
    requestedSeedUids: new Set(),
  }
}

/** Requested seeds still assembled (not dropped), in request order, with their items. */
function requestedItems(ctx: AssembleContext): Array<[string, Record<string, unknown>]> {
  const items: Array<[string, Record<string, unknown>]> = []
  for (const seedUid of ctx.requestedSeedUids) {
    const item = ctx.assembledItems.get(seedUid)
    if (item) items.push([seedUid, item])
  }
  return items
}

function ensureSeedIdentity(clone: Record<string, unknown>, seedUid: string): void {
  if (!clone.seedUid && !clone.SeedUid) {
    clone.seedUid = seedUid
    clone.SeedUid = seedUid
  } else if (clone.seedUid && !clone.SeedUid) {
    clone.SeedUid = clone.seedUid
  } else if (clone.SeedUid && !clone.seedUid) {
    clone.seedUid = clone.SeedUid
  }
  if (clone.attester && !clone.Attester) {
    clone.Attester = clone.attester
  } else if (clone.Attester && !clone.attester) {
    clone.attester = clone.Attester
  }
}

function addRelatedSeedUid(
  ctx: AssembleContext,
  property: AttestationLike,
  relatedSeedUid: string,
): void {
  ctx.relatedSeedUids.add(relatedSeedUid)
  const seedUid = ctx.versionUidToSeedUid.get(property.refUID)
  if (!seedUid) return
  const related = ctx.relatedSeedUidsBySeedUid.get(seedUid) ?? new Set<string>()
  related.add(relatedSeedUid)
  ctx.relatedSeedUidsBySeedUid.set(seedUid, related)
}

async function processItemProperty(
  ctx: AssembleContext,
  property: AttestationLike,
): Promise<void> {
  const parsed = parseEasPropertyMetadata(property.decodedDataJson)
  if (!parsed.ok) {
    const { id, refUID, schemaId } = property
    if (parsed.reason === 'empty') {
      console.warn(
        '[query] [processItemProperty] empty decodedDataJson for property:',
        id,
        refUID,
        schemaId,
      )
    } else if (parsed.reason === 'parse') {
      console.warn(
        '[query] [processItemProperty] failed to parse decodedDataJson for property:',
        id,
        refUID,
        schemaId,
        parsed.error,
      )
    } else {
      console.warn(
        '[query] [processItemProperty] invalid decodedDataJson structure for property:',
        id,
        refUID,
        schemaId,
      )
    }
    return
  }

  const metadata = parsed.metadata

  let propertyNameSnake = metadata.name
  if (!propertyNameSnake) {
    return
  }

  const schemaUid = property.schemaId
  setSchemaUidForSchemaDefinition({
    text: propertyNameSnake,
    schemaUid,
  })

  let isRelation = false
  let isList = false
  const easType = metadata.type
  // A removed property (ADR 0021): absent from the seed, and a zero uid is no related seed
  if (isEasEmptyValue(easType, metadata.value)) return
  const isBytes32Relation =
    (easType === 'bytes32' || easType === 'bytes32[]') &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'
  const isNamingConventionRelation =
    !isBytes32Relation &&
    (propertyNameSnake.endsWith('_id') || propertyNameSnake.endsWith('_ids')) &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'

  if (isBytes32Relation || isNamingConventionRelation) {
    isRelation = true
    if (Array.isArray(metadata.value)) {
      isList = true
      if (isNamingConventionRelation) {
        const result = parseEasRelationPropertyName(propertyNameSnake)
        if (result) {
          propertyNameSnake = result.propertyName
        }
      }
      metadata.value.forEach((value: string) => {
        if (!relationValuesToExclude.includes(value)) addRelatedSeedUid(ctx, property, value)
      })
    } else if (!relationValuesToExclude.includes(metadata.value as string)) {
      addRelatedSeedUid(ctx, property, metadata.value as string)
    }
  }

  let propertyValue: string | string[] = metadata.value as string | string[]
  if (isRelation && isList && Array.isArray(propertyValue)) {
    propertyValue = propertyValue.map((v) => String(v))
  } else if (typeof propertyValue !== 'string') {
    // ADR 0010: an integer value as its decimal string, not the indexer's `{ type: 'BigNumber', hex }`.
    const decimal = isNumericEasType(easType) ? decodeEasNumber(propertyValue) : undefined
    propertyValue = decimal ?? JSON.stringify(propertyValue)
  }

  const seedUidForProperty = ctx.versionUidToSeedUid.get(property.refUID)
  if (!seedUidForProperty) {
    return
  }

  const existingItem = ctx.assembledItems.get(seedUidForProperty) || {}
  existingItem[propertyNameSnake] = propertyValue
  const propertyNameCamel = toCamelCase(propertyNameSnake)
  if (propertyNameCamel !== propertyNameSnake) {
    existingItem[propertyNameCamel] = propertyValue
  }
  ctx.assembledItems.set(seedUidForProperty, existingItem)
}

/** Pins that name a version or a time, by lowercase seed UID. */
function activePins(pins: ReadonlyMap<string, VersionPin>): Map<string, VersionPin> {
  const active = new Map<string, VersionPin>()
  for (const [seedUid, pin] of pins) {
    if (pin.versionUid !== undefined || pin.asOf !== undefined) active.set(seedUid.toLowerCase(), pin)
  }
  return active
}

/** The seed's live version `pin` names (else its newest), if it was created by `pin.asOf`. */
function pinnedVersion(
  versions: AttestationLike[],
  pin: VersionPin,
): AttestationLike | undefined {
  const asOf = pin.asOf
  const candidates =
    asOf === undefined ? versions : versions.filter((v) => v.timeCreated <= asOf)
  if (pin.versionUid === undefined) {
    return [...candidates].sort((a, b) => b.timeCreated - a.timeCreated)[0]
  }
  const needle = pin.versionUid.toLowerCase()
  return candidates.find((v) => v.id.toLowerCase() === needle)
}

async function processSeeds(
  ctx: AssembleContext,
  seeds: AttestationLike[],
  dataSource: QueryDataSource,
  opts: {
    dropSeedsWithOnlyRevokedVersions?: boolean
    /**
     * Versions already fetched with `getVersionsForSeeds(…, { includeRevoked: true })` for these
     * seeds (and possibly others, which are ignored), so the request isn't made again.
     */
    versions?: AttestationLike[]
    /** Versions to assemble instead of the latest, by lowercase seed UID (see VersionPin). */
    pins?: ReadonlyMap<string, VersionPin>
  } = {},
): Promise<void> {
  const seedUids: string[] = []

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]
    if (!seed) continue
    seedUids.push(seed.id)
    const modelType = seed.schema?.schemaNames?.[0]?.name ?? 'unknown'
    ctx.seedUidToModelType.set(seed.id, modelType)

    if (!ctx.assembledItems.has(seed.id)) {
      ctx.assembledItems.set(seed.id, {
        seedUid: seed.id,
        timeCreated: seed.timeCreated,
        attester: seed.attester,
      })
    }
  }

  if (seedUids.length === 0) return

  // Revoked versions come back too (marked), in the same request, only so a seed whose versions
  // were all revoked can be told from one that never had a version; they are never used below.
  const requested = new Set(seedUids)
  const fetchedVersions = opts.versions
    ? opts.versions.filter((v) => requested.has(v.refUID))
    : await dataSource.getVersionsForSeeds(seedUids, { includeRevoked: true })
  // Anyone can attest with any refUID: only the seed's attester's versions count.
  const allVersions = keepAttestationsFromRefAttester(fetchedVersions, seeds)
  const itemVersions = allVersions.filter((v) => v.revoked !== true)

  if (opts.dropSeedsWithOnlyRevokedVersions) {
    // Like the SDK (latest published version skips revoked ones): every version revoked means
    // no published version, so the seed is left out. A seed with no version at all is kept.
    const seedsWithLiveVersion = new Set(itemVersions.map((v) => v.refUID))
    for (const version of allVersions) {
      const seedUid = version.refUID
      if (seedsWithLiveVersion.has(seedUid) || !requested.has(seedUid)) continue
      ctx.assembledItems.delete(seedUid)
      ctx.seedUidToModelType.delete(seedUid)
      ctx.droppedSeedUids.add(seedUid)
    }
  }

  for (let i = 0; i < itemVersions.length; i++) {
    const itemVersion = itemVersions[i] as AttestationLike
    const seedUid = itemVersion.refUID
    ctx.versionUidToSeedUid.set(itemVersion.id, seedUid)
    const existingVersions = ctx.versionsBySeedUid.get(seedUid) || []
    ctx.versionsBySeedUid.set(seedUid, [...existingVersions, itemVersion])
  }

  // Each seed's assembled version: the pinned one, else the latest. A pinned seed without that
  // version (not the seed's, revoked, or created after `asOf`) is left out, like a seed whose
  // versions were all revoked.
  const latestVersionUids: string[] = []
  const asOfByVersionUid = new Map<string, number>()
  for (const seedUid of seedUids) {
    const pin = opts.pins?.get(seedUid.toLowerCase())
    if (!pin) continue
    const pinned = pinnedVersion(ctx.versionsBySeedUid.get(seedUid) ?? [], pin)
    if (!pinned) {
      ctx.assembledItems.delete(seedUid)
      ctx.seedUidToModelType.delete(seedUid)
      ctx.versionsBySeedUid.delete(seedUid)
      ctx.droppedSeedUids.add(seedUid)
      continue
    }
    latestVersionUids.push(pinned.id)
    ctx.latestVersionUidsBySeedUid.set(seedUid, pinned.id)
    if (pin.asOf !== undefined) asOfByVersionUid.set(pinned.id, pin.asOf)
  }
  for (const [seedUid, versions] of ctx.versionsBySeedUid.entries()) {
    if (ctx.latestVersionUidsBySeedUid.has(seedUid)) continue
    const sortedVersions = [...versions].sort((a, b) => b.timeCreated - a.timeCreated)
    const latestVersion = sortedVersions[0]
    if (latestVersion) {
      latestVersionUids.push(latestVersion.id)
      ctx.latestVersionUidsBySeedUid.set(seedUid, latestVersion.id)
    }
  }

  if (latestVersionUids.length === 0) return

  const rawProperties = keepAttestationsFromRefAttester(
    await dataSource.getPropertiesForVersionUids(latestVersionUids),
    itemVersions,
  ).filter((property) => {
    const asOf = asOfByVersionUid.get(property.refUID)
    return asOf === undefined || property.timeCreated <= asOf
  })
  const itemProperties = pickLatestPropertyAttestationsByRefAndSchema(rawProperties)

  for (let i = 0; i < itemProperties.length; i++) {
    await processItemProperty(ctx, itemProperties[i] as AttestationLike)
  }
}

function resolveRelationPropertiesToUrls(ctx: AssembleContext): void {
  for (const [, item] of requestedItems(ctx)) {
    const keysToProcess = Object.keys(item).filter(
      (k) => !k.startsWith('_') && !RESERVED_KEYS.has(k),
    )

    for (const key of keysToProcess) {
      let value = item[key]
      const coerced = tryCoerceJsonStringArray(value)
      if (coerced !== value && Array.isArray(coerced)) {
        item[key] = coerced
        value = coerced
      }
      const isList = Array.isArray(value)

      if (isList) {
        const uids = value as unknown[]
        const hasRelationUid = uids.some(
          (v) =>
            typeof v === 'string' &&
            !relationValuesToExclude.includes(v) &&
            ctx.assembledItems.has(v),
        )
        if (!hasRelationUid) continue

        const urls: string[] = []
        const models: string[] = []
        let resolved = false
        for (const uid of uids) {
          if (typeof uid !== 'string' || relationValuesToExclude.includes(uid)) {
            urls.push(String(uid))
            models.push('unknown')
            continue
          }
          const modelForUid = ctx.seedUidToModelType.get(uid) ?? 'unknown'
          if (modelForUid === IMAGE_SCHEMA) {
            urls.push(uid)
            models.push(IMAGE_SCHEMA)
            continue
          }
          const related = ctx.assembledItems.get(uid)
          const txId = (related?.storageTransactionId ??
            related?.storage_transaction_id) as string | undefined
          if (txId && typeof txId === 'string' && txId.trim()) {
            try {
              urls.push(getArweaveUrlForTransaction(txId))
              models.push(modelForUid)
              resolved = true
            } catch {
              urls.push(uid)
              models.push(modelForUid)
            }
          } else {
            urls.push(uid)
            models.push(modelForUid)
          }
        }
        if (resolved) {
          const outputKey = publicListRelationPropertyKey(key)
          item[outputKey] = urls
          setListElementStorageModels(item, outputKey, models)
          stripListRelationStorageAliasesForPublicKey(item, outputKey)
          if (outputKey !== key) {
            delete item[key]
            const camelKey = toCamelCase(key)
            if (camelKey !== key) delete item[camelKey]
          }
        }
      } else if (typeof value === 'string') {
        if (relationValuesToExclude.includes(value)) continue
        if (!ctx.assembledItems.has(value)) continue

        const related = ctx.assembledItems.get(value)
        if (ctx.seedUidToModelType.get(value) === IMAGE_SCHEMA) {
          continue
        }
        const txId = (related?.storageTransactionId ?? related?.storage_transaction_id) as
          | string
          | undefined
        if (txId && typeof txId === 'string' && txId.trim()) {
          try {
            const outputKey = key.endsWith('_id') ? key.replace(/_id$/, '') : key
            item[outputKey] = getArweaveUrlForTransaction(txId)
            const relatedModel = ctx.seedUidToModelType.get(value) ?? 'unknown'
            setFieldStorageModel(item, outputKey, relatedModel)
            const camelOut = toCamelCase(outputKey)
            if (camelOut !== outputKey) {
              setFieldStorageModel(item, camelOut, relatedModel)
            }
            if (outputKey !== key) {
              delete item[key]
              const camelKey = toCamelCase(key)
              if (camelKey !== key) delete item[camelKey]
            }
          } catch {
            // keep original on error
          }
        }
      }
    }
  }
}

function expandRelationProperties(ctx: AssembleContext): void {
  for (const [, item] of requestedItems(ctx)) {
    const keysToProcess = Object.keys(item).filter(
      (k) => !k.startsWith('_') && !RESERVED_KEYS.has(k),
    )

    for (const key of keysToProcess) {
      let value = item[key]
      const coerced = tryCoerceJsonStringArray(value)
      if (coerced !== value && Array.isArray(coerced)) {
        item[key] = coerced
        value = coerced
      }
      const isList = Array.isArray(value)
      const uids = isList ? (value as unknown[]) : [value]

      const expanded: unknown[] = []
      let didExpand = false

      for (const uid of uids) {
        if (typeof uid !== 'string' || relationValuesToExclude.includes(uid)) {
          expanded.push(uid)
          continue
        }
        const related = ctx.assembledItems.get(uid)
        if (!related) {
          expanded.push(uid)
          continue
        }
        const txId = (related?.storageTransactionId ?? related?.storage_transaction_id) as
          | string
          | undefined
        const isImage = ctx.seedUidToModelType.get(uid) === IMAGE_SCHEMA

        if (isImage) {
          const clone = { ...related } as Record<string, unknown>
          ensureSeedIdentity(clone, uid)
          clone.schemaName = IMAGE_SCHEMA
          enrichImageSeedClone(clone)
          expanded.push(clone)
          didExpand = true
          continue
        }

        if (txId && typeof txId === 'string' && txId.trim()) {
          expanded.push(uid)
          continue
        }
        const clone = { ...related } as Record<string, unknown>
        ensureSeedIdentity(clone, uid)
        expanded.push(clone)
        didExpand = true
      }

      if (didExpand) {
        const outputKey = isList
          ? publicListRelationPropertyKey(key)
          : key.endsWith('_id')
            ? key.replace(/_id$/, '')
            : key
        item[outputKey] = isList ? expanded : expanded[0]
        stripListRelationStorageAliasesForPublicKey(item, outputKey)
        if (outputKey !== key) {
          delete item[key]
          const camelKey = toCamelCase(key)
          if (camelKey !== key) delete item[camelKey]
        }
      }
    }
  }
}

/** A record still being assembled (hydration fills in its data); read-only once returned. */
type AssembledRecord = Omit<SeedRecord, 'data'> & { data: Record<string, unknown> }

function toSeedRecords(ctx: AssembleContext, schemaName?: string): AssembledRecord[] {
  return requestedItems(ctx).map(([seedUid, item]) => {
    const versionUid = ctx.latestVersionUidsBySeedUid.get(seedUid) ?? ''
    if (versionUid) {
      item.versionUid = versionUid
    }
    ensureSeedIdentity(item, seedUid)
    const timeCreated =
      typeof item.timeCreated === 'number' ? item.timeCreated : 0
    const attester =
      typeof item.attester === 'string'
        ? item.attester
        : typeof item.Attester === 'string'
          ? item.Attester
          : undefined
    return {
      seedUid,
      schemaName: schemaName ?? ctx.seedUidToModelType.get(seedUid) ?? 'unknown',
      attester,
      timeCreated,
      versionUid,
      data: item,
    }
  })
}

/**
 * What an assembled record was built from, so a cache can tell when it changed: an attestation
 * created or revoked later that references one of `refUIDs` (a new or revoked Version of the seed
 * or of a seed it relates to, a property of one of their head Versions) or is one of `ids` (the
 * seed or a related seed, revoked).
 */
export type SeedDependencies = {
  refUIDs: string[]
  ids: string[]
}

function dependenciesOf(
  ctx: AssembleContext,
  seedUid: string,
  withRelated: boolean,
): SeedDependencies {
  const related = withRelated ? (ctx.relatedSeedUidsBySeedUid.get(seedUid) ?? []) : []
  const seedUids = [seedUid, ...related]
  const headVersionUids = seedUids
    .map((uid) => ctx.latestVersionUidsBySeedUid.get(uid))
    .filter((uid): uid is string => !!uid)
  return { refUIDs: [...seedUids, ...headVersionUids], ids: seedUids }
}

export type AssembleRequest = {
  /** The schema name every record gets. Default: each seed's own (its first schema name). */
  schemaName?: string
  /** Versions of the seeds already fetched with `includeRevoked: true` (see getSeed). */
  versions?: AttestationLike[]
  /**
   * Versions to assemble instead of the latest, by seed UID. Applies to `seeds` only: related
   * seeds are always assembled at their latest version.
   */
  pins?: ReadonlyMap<string, VersionPin>
}

/**
 * Like assembleSeeds, plus each record's dependencies by seedUid (see SeedDependencies).
 */
export async function assembleSeedsWithDependencies(
  schemaName: string,
  seeds: AttestationLike[],
  options?: AssembleOptions,
  dataSource: QueryDataSource = getRemoteQueryDataSource(),
  /** Versions of `seeds` already fetched with `includeRevoked: true` (see getSeed). */
  prefetched?: { versions?: AttestationLike[] },
): Promise<{ records: SeedRecord[]; dependencies: Map<string, SeedDependencies> }> {
  return assembleSeedRecords(seeds, options, dataSource, {
    schemaName,
    versions: prefetched?.versions,
  })
}

/**
 * Records for `seeds`, in order, which may be of different schemas, with each record's
 * dependencies by seedUid. One set of requests for all of them: seeds and versions, properties,
 * related seeds and their versions, related properties, then storage bodies. With
 * `relations: 'uids'` it stops after properties (storage bodies are still read): relation values
 * stay seed UIDs and a record depends only on its seed and head version.
 */
export async function assembleSeedRecords(
  seeds: AttestationLike[],
  options: AssembleOptions | undefined,
  dataSource: QueryDataSource,
  request: AssembleRequest = {},
): Promise<{ records: SeedRecord[]; dependencies: Map<string, SeedDependencies> }> {
  const relations = relationsModeOf(options)
  const hydrateStorage = options?.hydrateStorage !== false

  const ctx = createAssembleContext()
  for (const seed of seeds) if (seed) ctx.requestedSeedUids.add(seed.id)

  await processSeeds(ctx, seeds, dataSource, {
    dropSeedsWithOnlyRevokedVersions: true,
    versions: request.versions,
    pins: request.pins && activePins(request.pins),
  })

  const relatedSeedUidsArray = Array.from(ctx.relatedSeedUids).filter(
    (uid) => !ctx.assembledItems.has(uid) && !ctx.droppedSeedUids.has(uid),
  )
  if (relations !== 'uids' && relatedSeedUidsArray.length > 0) {
    // Their versions only need the UIDs, so they are fetched alongside the seeds. Versions of a
    // related seed that isn't returned (revoked, or not found) are ignored by processSeeds.
    const [relatedSeeds, relatedVersions] = await Promise.all([
      dataSource.getSeedsByUids(relatedSeedUidsArray),
      dataSource.getVersionsForSeeds(relatedSeedUidsArray, { includeRevoked: true }),
    ])
    await processSeeds(ctx, relatedSeeds, dataSource, { versions: relatedVersions })
  }

  if (relations !== 'uids') resolveRelationPropertiesToUrls(ctx)
  if (relations === 'expand') expandRelationProperties(ctx)

  const records = toSeedRecords(ctx, request.schemaName)

  if (hydrateStorage) {
    await hydrateArweaveRichTextInItems(
      records.map((r) => r.data),
      dataSource.readStorageBody
        ? { readStorageBody: dataSource.readStorageBody.bind(dataSource) }
        : undefined,
    )
  }

  const withRelated = relations !== 'uids'
  const dependencies = new Map(
    records.map((record) => [record.seedUid, dependenciesOf(ctx, record.seedUid, withRelated)]),
  )
  return { records, dependencies }
}

/**
 * Assemble canonical SeedRecords from Seed attestations (latest Version + canonical properties).
 * Uses per-call state (safe for concurrent requests).
 */
export async function assembleSeeds(
  schemaName: string,
  seeds: AttestationLike[],
  options?: AssembleOptions,
  dataSource: QueryDataSource = getRemoteQueryDataSource(),
): Promise<SeedRecord[]> {
  return (await assembleSeedsWithDependencies(schemaName, seeds, options, dataSource)).records
}
