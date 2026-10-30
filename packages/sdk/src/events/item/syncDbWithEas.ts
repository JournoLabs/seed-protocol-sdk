import { resolveItemModelFileId } from '@/db/read/resolveModelRecord'
import { resolveModelForSyncedSeed, skipSeedOnAmbiguousModel } from '@/db/read/resolveModelForSyncedSeed'
import { camelCase } from 'lodash-es'
import {
  Attestation,
  easName,
  isEasEmptyValue,
  isNameMatchLevel,
  isUnfilledReference,
  matchEasName,
  partitionByRefAttester,
  matchEasModelSchemas,
} from '@seedprotocol/eas'
import { loadNameMatchLevels, nameMatchLevels } from '@/db/read/nameMatchLevels'
import { normalizeDataType } from '@/helpers/property'
import { easTypeFitsProperty, syncedPropertyValue } from '@/helpers/easValueTypes'
import {
  easPropertyNameForPublish,
  listRelationEasPropertyName,
  metadataStorageName,
} from '@/helpers/metadataPropertyNames'
import { resolveMetadataPropertyId } from '@/db/read/metadataProperty'
import {
  parseEasPropertyMetadata,
  parseEasRelationPropertyName,
} from '@seedprotocol/query'
import {
  metadata,
  MetadataType,
  SeedType,
  versions,
  VersionsType,
} from '@/seedSchema'
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import {
  generateId,
} from '@/helpers'
import { modelPropertiesToObject } from '@/helpers/model'
import { GET_SEEDS } from '@seedprotocol/eas'
import {
  getAllAddressesFromDb,
  getItemStoragePropertiesForModel,
} from '@/helpers/db'
// Dynamic import to break circular dependency: Model -> BaseItem -> ... -> syncDbWithEas -> Model
// import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { writeModelUids } from '@/db/write/writeModelUids'
import { localModelSchemaLookups } from '@/db/read/localModelSchemaLookups'
import { ModelSchema } from '@/types'
import { createSeeds } from '@/db/write/createSeeds'
import { findSeedRowsByUid } from '@/db/read/findSeedRowsByUid'
import { rowsPerInsert, selectInBatches, writeInBatches } from '@/db/sqlParamBatches'
import { normalizeHexAddress } from '@/helpers/addresses'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { BaseEasClient, setSchemaUidForSchemaDefinition } from '@seedprotocol/eas'
import {
  getItemPropertiesFromEas,
  getItemVersionsFromEas,
  getModelSchemasFromEas,
  getSeedsFromSchemaUids,
} from '@/eas'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@/helpers/easPropertyCanonical'
import { getGetAdditionalSyncAddresses } from '@/helpers/publishConfig'
import { scheduleBulkFilesDownloadFromEasSync } from '@/events/files/download'
import { assertLocalDbChain, waitForEasReadChain } from '@/helpers/localDbChain'
import { EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@/helpers/constants'
import { emitAcrossTabs } from '@/helpers/tabEvents'
import { isBrowser } from '@/helpers/environment'

/**
 * Sync stores the newest non-revoked attestation per (version, property schema). When every
 * attestation of a property is revoked (e.g. after `item.unpublish()`), keep the newest one so a
 * revoked item synced to a new device still has its last values next to its seed's `revokedAt`.
 */
const SYNC_CANONICAL_OPTIONS = { ifAllRevoked: 'newestRevoked' } as const

/**
 * When an attestation was revoked, in Unix seconds: EAS `revocationTime` is a block timestamp in
 * seconds, the same unit local unpublish writes to `seeds.revoked_at`. `undefined` when not revoked.
 * A revoked attestation without a revocation time (0 or not selected) falls back to now.
 */
const revokedAtSeconds = (
  attestation: Pick<Attestation, 'revoked'> & { revocationTime?: number | null },
): number | undefined => {
  if (!attestation.revoked) return undefined
  return attestation.revocationTime != null && attestation.revocationTime > 0
    ? attestation.revocationTime
    : Math.floor(Date.now() / 1000)
}

/**
 * `revoked_at` to store for an attestation that already has a row (seed, version or metadata), given the
 * stored value. EAS's `revocationTime` wins once EAS reports one. A stored stamp is otherwise kept:
 * local unpublish writes one only after its revoke transactions are mined, and revocation can't be
 * undone, so EAS reporting the attestation as live then just means its index hasn't caught up yet.
 */
const syncedRevokedAt = (
  attestation: Pick<Attestation, 'revoked'> & { revocationTime?: number | null },
  stored: number | null | undefined,
): number | null => {
  if (attestation.revoked && attestation.revocationTime != null && attestation.revocationTime > 0) {
    return attestation.revocationTime
  }
  return stored ?? revokedAtSeconds(attestation) ?? null
}



/** A property attestation revoked while its seed is live: a retraction (ADR 0021), stored as no value. */
const isRetracted = (property: Pick<Attestation, 'revoked' | 'refUID'>, itemSeeds: Attestation[], state: SyncRunState) => {
  if (!property.revoked) return false
  const seedUid = state.versionUidToSeedUid.get(property.refUID)
  return !itemSeeds.find((seed) => seed.id === seedUid)?.revoked
}


/**
 * Lookups one `runSyncFromEas` run builds up as it stores seeds and versions, and the relation
 * targets its properties point at. Created per run and passed down, so a run never sees another
 * run's seeds or re-fetches its related seeds, even when runs overlap.
 */
type SyncRunState = {
  seedUidToLocalId: Map<string, string>
  seedUidToModelType: Map<string, string>
  versionUidToLocalId: Map<string, string>
  versionUidToSeedUid: Map<string, string>
  relatedSeedUids: Set<string>
}

const createSyncRunState = (): SyncRunState => ({
  seedUidToLocalId: new Map(),
  seedUidToModelType: new Map(),
  versionUidToLocalId: new Map(),
  versionUidToSeedUid: new Map(),
  relatedSeedUids: new Set(),
})

const isRelationPropertyName = (propertyNameSnake: string): boolean =>
  (propertyNameSnake.endsWith('_id') || propertyNameSnake.endsWith('_ids')) &&
  propertyNameSnake !== 'storage_transaction_id' &&
  propertyNameSnake !== 'storage_provider_transaction_id'

type SyncedPropertyName = {
  /** The matched local property's schema key; undefined when no local property matched. */
  key?: string
  /** metadata.property_name for the row. */
  propertyName: string
  isRelation: boolean
  isList: boolean
  /** A list relation's ref model, until the related seeds say otherwise. */
  refSeedType?: string
  /** The matched local property's data type; undefined when no local property matched. */
  dataType?: string
  /** The matched local property's schemaFileId, for property_id. */
  definitionId?: string
}

const RELATION_DATA_TYPES = new Set(['Relation', 'Image', 'File', 'Html'])

/**
 * The local property an EAS property name stands for (ADR 0008): matched against the model's
 * properties by the names publish writes for them (exact, then normalized, then fuzzy), not by
 * reversing the EAS name. The row is stored under the name sync has always used for that property:
 * a list relation's schema key, a single relation's `<key>Id`, anything else its key. A relation is
 * whatever the local property is, whatever its EAS name ends in.
 *
 * With no model, or no matching property, the EAS name decides as before (`_id`/`_ids` are
 * relations), so related seeds are still followed for discovery. Undefined: the name matches
 * several local properties equally well, and the attestation is skipped.
 */
export const resolveSyncedPropertyName = (
  easPropertyName: string,
  value: unknown,
  modelSchema: Record<string, any> | undefined,
  easType?: string,
): SyncedPropertyName | undefined => {
  const internal = easPropertyName === 'storage_transaction_id' || easPropertyName === 'storage_provider_transaction_id'
  if (modelSchema && !internal) {
    const candidates = Object.entries(modelSchema).map(([key, def]) => {
      const dataType = normalizeDataType(def?.dataType)
      const refValueType = normalizeDataType(def?.refValueType)
      const isListRelation = !!listRelationEasPropertyName(key, def)
      const isSingleRef = !isListRelation && (RELATION_DATA_TYPES.has(dataType) || RELATION_DATA_TYPES.has(refValueType))
      return {
        value: { key, def, isListRelation, isSingleRef },
        name: easPropertyNameForPublish(key, { ...def, name: key }),
        relation: isListRelation || isSingleRef,
        // ADR 0009: set by modelSchemaForSyncedProperty from the schema file.
        level: isNameMatchLevel(def?.nameMatch) ? def.nameMatch : undefined,
      }
    })
    const match = matchEasName(easPropertyName, candidates)
    if (match.kind === 'ambiguous') {
      console.warn(
        `[item/events] [syncDbWithEas] EAS property "${easPropertyName}" matches several local properties (${match.values
          .map((v) => v.key)
          .join(', ')}); skipping it`,
      )
      return undefined
    }
    if (match.kind === 'match') {
      const { key, def, isListRelation, isSingleRef } = match.value
      // ADR 0008/0010: property types must agree. A mismatch is this property's, refused.
      if (!easTypeFitsProperty(def?.dataType, easType, value)) {
        console.warn(
          `[item/events] [syncDbWithEas] EAS property "${easPropertyName}" is ${easType}, which doesn't fit local property "${key}" (${def?.dataType}); skipping it`,
        )
        return undefined
      }
      // Stored under the property's storage name, as local writers store it (decision D4)
      const propertyName = metadataStorageName(key, def)
      const definitionId = typeof def?.id === 'string' && def.id ? def.id : undefined
      if (isListRelation) {
        return { key, propertyName, isRelation: true, isList: true, refSeedType: def?.ref ? easName(def.ref) : undefined, definitionId }
      }
      if (isSingleRef) {
        return { key, propertyName, isRelation: true, isList: false, definitionId }
      }
      return { key, propertyName, isRelation: false, isList: false, dataType: normalizeDataType(def?.dataType), definitionId }
    }
    // A name one of the model's properties would match at a looser level than its nameMatch
    // allows is that property's, refused (ADR 0009): don't store it under a name of its own.
    if (matchEasName(easPropertyName, candidates.map((c) => ({ ...c, level: 'fuzzy' as const }))).kind !== 'none') {
      return undefined
    }
  }

  if (!isRelationPropertyName(easPropertyName)) {
    return { propertyName: camelCase(easPropertyName), isRelation: false, isList: false }
  }
  if (Array.isArray(value)) {
    const parsed = parseEasRelationPropertyName(easPropertyName)
    return {
      propertyName: camelCase(parsed?.propertyName ?? easPropertyName),
      isRelation: true,
      isList: true,
      refSeedType: parsed?.modelName,
    }
  }
  return { propertyName: camelCase(easPropertyName), isRelation: true, isList: false }
}

/** The local model schema (properties object) of the seed a property attestation belongs to. */
const modelSchemaForSyncedProperty = async (
  Model: typeof import('../../Model/Model').Model,
  property: Attestation,
  state: SyncRunState,
): Promise<Record<string, any> | undefined> => {
  const seedUid = state.versionUidToSeedUid.get(property.refUID)
  const modelType = seedUid ? state.seedUidToModelType.get(seedUid) : undefined
  if (modelType == null) return undefined
  const seedLocalId = state.seedUidToLocalId.get(seedUid!)
  const model = await skipSeedOnAmbiguousModel({ seedLocalId, seedUid }, 'easSync.metadata', async () =>
    resolveSyncedSeedModel(Model, modelType, { seedLocalId, seedUid }),
  )
  if (!model?.properties) return undefined
  // Each property's nameMatch level (ADR 0009), for resolveSyncedPropertyName.
  const levels = await nameMatchLevels()
  const schema = modelPropertiesToObject(model.properties)
  for (const [key, def] of Object.entries(schema)) {
    schema[key] = { ...def, nameMatch: levels.property(model.modelName ?? '', key, model.id) }
  }
  return schema
}

/**
 * Seed UIDs that relation properties point at. Collected from every property the run fetched, not
 * only newly stored ones, so related seeds are refreshed (new versions, revocations) on each sync.
 */
const collectRelatedSeedUids = async (
  properties: Attestation[],
  state: SyncRunState,
): Promise<void> => {
  const { Model } = await import('../../Model/Model')
  for (const property of properties) {
    const parsed = parseEasPropertyMetadata(property.decodedDataJson)
    if (!parsed.ok) continue
    const { name, value } = parsed.metadata
    if (!name) continue
    const modelSchema = await modelSchemaForSyncedProperty(Model, property, state)
    if (!resolveSyncedPropertyName(name, value, modelSchema)?.isRelation) continue
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (typeof v === 'string' && v && !isUnfilledReference(v) && !isEasEmptyValue('bytes32', v)) {
        state.relatedSeedUids.add(v)
      }
    }
  }
}

/**
 * seeds.type for a seed whose EAS model name is `easModelName`: the type of the local model it
 * matches (ADR 0008), so `htmlpage` from an older SDK is stored as `html_page`, the type local seeds
 * of HTMLPage have. A name matching no local model, or several, is kept as it is.
 */
const localModelType = async (easModelName: string): Promise<string> => {
  const { Model } = await import('../../Model/Model')
  try {
    const model = Model.findByModelType(easModelName)
    return model?.modelName ? easName(model.modelName) : easModelName
  } catch {
    return easModelName
  }
}

type SaveEasSeedsToDbProps = {
  itemSeeds: Attestation[]
  state: SyncRunState
}

type SaveEasSeedsToDbReturn = {
  /** UIDs of every seed passed in (already stored or newly inserted). */
  seedUids: string[]
}

type SaveEasSeedsToDb = (
  props: SaveEasSeedsToDbProps,
) => Promise<SaveEasSeedsToDbReturn>

const saveEasSeedsToDb: SaveEasSeedsToDb = async ({ itemSeeds, state }) => {
  const { seedUidToLocalId, seedUidToModelType } = state

  const seedUids = itemSeeds.map((seed) => seed.id)

  // By versions first: a republished seed's old uid is that seed, not a new one (see findSeedRowsByUid).
  const existingSeedByUid = await findSeedRowsByUid(seedUids)

  for (const [uid, row] of existingSeedByUid) {
    if (row.localId) {
      seedUidToLocalId.set(uid, row.localId)
    }
    if (row.type) {
      seedUidToModelType.set(uid, row.type)
    }
  }

  const newSeeds = itemSeeds.filter((seed) => !existingSeedByUid.has(seed.id))

  // Update existing seeds when attestations are revoked on EAS, and replace a local unpublish stamp
  // with EAS's revocationTime once EAS reports one (see `syncedRevokedAt`). A seed matched by an old
  // uid has moved to a new attestation, so the old one's revocation is not its state.
  for (const seed of itemSeeds) {
    const row = existingSeedByUid.get(seed.id)
    if (!row?.localId || row.uid !== seed.id) continue
    const revokedAt = syncedRevokedAt(seed, row.revokedAt)
    if (revokedAt == null || revokedAt === row.revokedAt) continue
    await updateSeedRevokedAt({ seedLocalId: row.localId, revokedAt })
  }

  if (newSeeds.length === 0) {
    return { seedUids }
  }

  const newSeedsData: Partial<SeedType>[] = []

  for (let i = 0; i < newSeeds.length; i++) {
    const seed = newSeeds[i]
    const modelType = await localModelType(seed.schema.schemaNames[0].name)
    seedUidToModelType.set(seed.id, modelType)
    const seedLocalId = generateId()
    seedUidToLocalId.set(seed.id, seedLocalId)

    // createSeeds binds parameters: store the JSON as is.
    const attestationRaw = JSON.stringify(seed)
    const revokedAt = revokedAtSeconds(seed)

    // EAS only knows the model by name; the seam may match it to a local model (not built yet).
    const modelFileId = await resolveModelForSyncedSeed({
      seedUid: seed.id,
      seedLocalId,
      modelType,
      schemaUid: seed.schemaId,
    })

    newSeedsData.push({
      localId: seedLocalId,
      uid: seed.id,
      schemaUid: seed.schemaId,
      type: modelType,
      ...(modelFileId && { modelFileId }),
      publisher: seed.attester ? normalizeHexAddress(seed.attester) : seed.attester,
      attestationCreatedAt: seed.timeCreated * 1000,
      attestationRaw,
      ...(revokedAt !== undefined && { revokedAt }),
    })
  }

  const inserted = await createSeeds(newSeedsData)
  // A row another writer stored for the uid since the lookup above (publish recording it) is the seed.
  const raced = newSeedsData.filter((row) => !inserted.has(row.localId!)).map((row) => row.uid!)
  if (raced.length > 0) {
    for (const [uid, row] of await findSeedRowsByUid(raced)) {
      if (row.localId) seedUidToLocalId.set(uid, row.localId)
      if (row.type) seedUidToModelType.set(uid, row.type)
    }
  }

  // All fetched seeds, not only the new ones: existing seeds can have new versions on EAS.
  return { seedUids }
}

type SaveEasVersionsToDbParams = {
  itemVersions: Attestation[]
  state: SyncRunState
}

type SaveEasVersionsToDb = (
  props: SaveEasVersionsToDbParams,
) => Promise<SaveEasVersionsToDbReturn>

type SaveEasVersionsToDbReturn = {
  versionUids: string[]
}

/**
 * Rows per versions INSERT. A row binds at most one parameter per `versions` column (12 today, 10
 * set by sync), so a batch binds at most 600: under SQLite's old default limit of 999 host
 * parameters (sqlite-wasm and libsql allow more). saveEasVersionsBatches.test.ts checks this.
 */
export const VERSION_INSERT_BATCH = 50

const saveEasVersionsToDb: SaveEasVersionsToDb = async ({ itemVersions, state }) => {
  const { seedUidToLocalId, seedUidToModelType, versionUidToLocalId, versionUidToSeedUid } = state
  const versionUids = itemVersions.map((version) => version.id)

  const appDb = BaseDb.getAppDb()

  const existingVersionRecordsRows: VersionsType[] = await selectInBatches(versionUids, (chunk) =>
    appDb.select().from(versions).where(inArray(versions.uid, chunk)),
  )

  const existingVersionUids = new Set<string>()
  const versionByUid = new Map(itemVersions.map((version) => [version.id, version]))

  if (existingVersionRecordsRows && existingVersionRecordsRows.length > 0) {
    for (const row of existingVersionRecordsRows) {
      if (row.uid) {
        existingVersionUids.add(row.uid)
        if (row.localId) {
          versionUidToLocalId.set(row.uid, row.localId)
        }
        if (row.seedUid) {
          versionUidToSeedUid.set(row.uid, row.seedUid)
        }
        // Already-stored versions pick up revocations (and EAS's revocation time) too.
        const attestation = versionByUid.get(row.uid)
        const revokedAt = attestation ? syncedRevokedAt(attestation, row.revokedAt) : null
        if (attestation && revokedAt !== (row.revokedAt ?? null)) {
          await appDb
            .update(versions)
            .set({ revokedAt })
            .where(eq(versions.uid, row.uid))
        }
      }
    }
  }

  const newVersions = itemVersions.filter(
    (version) => !existingVersionUids.has(version.id),
  )

  const rows: (typeof versions.$inferInsert)[] = []
  const storedVersionUids = new Set(existingVersionUids)
  for (const version of newVersions) {
    const seedUid = version.refUID
    const seedLocalId = seedUidToLocalId.get(seedUid)
    if (!seedLocalId) {
      // Storing it anyway would orphan the version (and its properties) from any local seed.
      console.warn(
        '[item/events] [syncDbWithEas] skipping version whose seed has no local id: ',
        version.id,
        seedUid,
      )
      continue
    }
    const versionLocalId = generateId()
    versionUidToSeedUid.set(version.id, seedUid)
    versionUidToLocalId.set(version.id, versionLocalId)
    storedVersionUids.add(version.id)
    rows.push({
      localId: versionLocalId,
      uid: version.id,
      seedUid,
      seedLocalId,
      seedType: seedUidToModelType.get(seedUid) ?? null,
      attestationCreatedAt: version.timeCreated * 1000,
      attestationRaw: JSON.stringify(version),
      publisher: version.attester ? normalizeHexAddress(version.attester) : '',
      revokedAt: revokedAtSeconds(version) ?? null,
    })
  }

  // Bound parameters: keep each statement well under SQLite's host-parameter limit.
  // A uid another writer stored since the lookup above is not inserted again (versions.uid is
  // unique): its row is the version.
  const insertedLocalIds = new Set<string>()
  for (let i = 0; i < rows.length; i += VERSION_INSERT_BATCH) {
    const inserted = await appDb
      .insert(versions)
      .values(rows.slice(i, i + VERSION_INSERT_BATCH))
      .onConflictDoNothing()
      .returning({ localId: versions.localId })
    for (const row of inserted) if (row.localId) insertedLocalIds.add(row.localId)
  }
  const raced = rows.filter((row) => !insertedLocalIds.has(row.localId!)).map((row) => row.uid!)
  if (raced.length > 0) {
    const stored: VersionsType[] = await selectInBatches(raced, (chunk) =>
      appDb.select().from(versions).where(inArray(versions.uid, chunk)),
    )
    for (const row of stored) {
      if (!row.uid) continue
      if (row.localId) versionUidToLocalId.set(row.uid, row.localId)
      if (row.seedUid) versionUidToSeedUid.set(row.uid, row.seedUid)
    }
  }

  // Only versions that are stored locally: properties of a skipped version would have no version row.
  return { versionUids: versionUids.filter((uid) => storedVersionUids.has(uid)) }
}

const createMetadataRecordsForStorageTransactionId = async (
  storageTransactionIdProperty: Attestation,
  modelSchema: ModelSchema | undefined,
  state: SyncRunState,
) => {
  const { seedUidToLocalId, seedUidToModelType, versionUidToLocalId, versionUidToSeedUid } = state

  // Validate and parse decodedDataJson
  const parsed = parseEasPropertyMetadata(
    storageTransactionIdProperty.decodedDataJson,
  )
  if (!parsed.ok) {
    if (parsed.reason === 'empty') {
      console.warn(
        '[item/events] [syncDbWithEas] empty decodedDataJson for storageTransactionIdProperty: ',
        storageTransactionIdProperty.id,
      )
    } else if (parsed.reason === 'parse') {
      console.warn(
        '[item/events] [syncDbWithEas] failed to parse decodedDataJson for storageTransactionIdProperty: ',
        storageTransactionIdProperty.id,
        parsed.error,
      )
    } else {
      console.warn(
        '[item/events] [syncDbWithEas] invalid decodedDataJson structure for storageTransactionIdProperty: ',
        storageTransactionIdProperty.id,
      )
    }
    return
  }

  const attestationData = parsed.metadata
  // A string tx id attested under the legacy `bytes32 storage_transaction_id` schema (0xa1a5bee9…,
  // Optimism Sepolia only) decodes as 0x…20, the ABI string offset; the id itself is only in the raw
  // `data`. It is stored as-is and the download path skips it. Not recovered: the 8 such
  // attestations on Optimism Sepolia date from February 2024, and publish no longer creates them.
  const propertyValue =
    typeof attestationData.value === 'string'
      ? attestationData.value
      : JSON.stringify(attestationData.value)

  const seedUid = versionUidToSeedUid.get(storageTransactionIdProperty.refUID) as string
  const seedLocalId = seedUidToLocalId.get(seedUid)
  const versionUid = storageTransactionIdProperty.refUID
  const versionLocalId = versionUidToLocalId.get(versionUid)
  const modelType = seedUidToModelType.get(seedUid)

  // Storage settings come from the `properties` table. The model's property instances (modelSchema)
  // are only a fallback: whether they have loaded, and with storage settings, depends on timing.
  const itemStorageProperties = new Map<
    string,
    { id?: number; localStorageDir?: string | null; filenameSuffix?: string | null }
  >()
  if (modelType != null) {
    const stored =
      (await skipSeedOnAmbiguousModel({ seedLocalId, seedUid }, 'easSync.storageTransactionId', async () =>
        getItemStoragePropertiesForModel(modelType, {
          modelFileId: await resolveItemModelFileId({ seedLocalId, seedUid }),
        }),
      )) ?? []
    for (const property of stored) itemStorageProperties.set(property.name, property)
  }
  if (itemStorageProperties.size === 0 && modelSchema) {
    for (const [_propertyName, propertyDef] of Object.entries(modelSchema)) {
      if (propertyDef?.storageType === 'ItemStorage') {
        itemStorageProperties.set(_propertyName, {
          localStorageDir: propertyDef.localStorageDir,
          filenameSuffix: propertyDef.filenameSuffix,
        })
      }
    }
  }

  if (itemStorageProperties.size === 0) {
    return
  }

  const appDb = BaseDb.getAppDb()

  for (const [_propertyName, propertyDef] of itemStorageProperties.entries()) {
    const existingMetadataRecordRows = await appDb
      .select({ localId: metadata.localId })
      .from(metadata)
      .where(
        and(
          isNotNull(metadata.derivedFromUid),
          eq(metadata.propertyName, _propertyName),
          eq(metadata.propertyValue, propertyValue),
          eq(metadata.versionUid, storageTransactionIdProperty.refUID),
        ),
      )

    // Already derived from another attestation carrying this transaction id: syncDerivedStorageRows
    // points that row at the canonical attestation.
    if (existingMetadataRecordRows && existingMetadataRecordRows.length > 0) {
      continue
    }

    const propertyId =
      (await skipSeedOnAmbiguousModel({ seedLocalId, seedUid }, 'easSync.storageTransactionId', async () =>
        resolveMetadataPropertyId({
          definitionId: propertyDef.id,
          propertyName: _propertyName,
          modelName: modelType,
          seedLocalId,
          seedUid,
        }),
      )) ?? null

    const propertyLocalId = generateId()
    await appDb.insert(metadata).values({
      localId: propertyLocalId,
      propertyId: propertyId ?? undefined,
      propertyName: _propertyName,
      propertyValue,
      localStorageDir: propertyDef.localStorageDir ?? undefined,
      seedLocalId,
      seedUid,
      versionLocalId,
      versionUid,
      refValueType: 'file',
      refResolvedValue: `${propertyValue}${propertyDef.filenameSuffix ?? ''}`,
      modelType: seedUidToModelType.get(seedUid),
      derivedFromUid: storageTransactionIdProperty.id,
      // Ranked like a synced row, at its attestation's time: a local edit made after that
      // publish wins over it, a newer publish wins over an older edit.
      attestationCreatedAt: storageTransactionIdProperty.timeCreated * 1000,
    })
  }
}

type SaveEasPropertiesToDbParams = {
  /** Every property attestation fetched for a set of versions, revoked ones included. */
  fetchedProperties: Attestation[]
  itemSeeds: Attestation[]
  state: SyncRunState
}

type SaveEasPropertiesToDbReturn = {
  propertyUids: string[]
}

type SaveEasPropertiesToDb = (
  props: SaveEasPropertiesToDbParams,
) => Promise<SaveEasPropertiesToDbReturn>

/** Serialize property saves: concurrent `runSyncFromEas` used to hit `isSavingToDb` and return `{}` with no insert. */
let saveEasPropertiesDbChain: Promise<unknown> = Promise.resolve()

/**
 * Make local metadata match EAS for every fetched (version, property schema): exactly one synced
 * row, for the canonical attestation (ADR 0006), with `revoked_at` set when that attestation is
 * revoked (which, with `SYNC_CANONICAL_OPTIONS`, means all of the property's attestations on that
 * version are).
 *
 * - Canonical attestation not stored yet: insert it. This also covers an older live attestation
 *   taking over from a revoked newer one, and a newer attestation superseding the stored one.
 * - Stored row for a fetched attestation that isn't canonical (revoked, or superseded): delete it,
 *   so readers, which take the newest row per property, can't pick it.
 * - Stored canonical row: bring `revoked_at` up to date.
 *
 * Rows without an attestation UID (local edits) and rows for attestations EAS didn't return are
 * left alone.
 */
const saveEasPropertiesToDbBody = async ({
  fetchedProperties,
  itemSeeds,
  state,
}: SaveEasPropertiesToDbParams): Promise<SaveEasPropertiesToDbReturn> => {
  const itemProperties = pickLatestPropertyAttestationsByRefAndSchema(
    fetchedProperties,
    SYNC_CANONICAL_OPTIONS,
  )
  const propertyUids = itemProperties.map((property) => property.id)

  await collectRelatedSeedUids(itemProperties, state)

  const appDb = BaseDb.getAppDb()

  const storedRows: Pick<MetadataType, 'uid' | 'revokedAt'>[] = await selectInBatches(
    fetchedProperties.map((property) => property.id),
    (chunk) =>
      appDb
        .select({ uid: metadata.uid, revokedAt: metadata.revokedAt })
        .from(metadata)
        .where(inArray(metadata.uid, chunk)),
  )

  const canonicalByUid = new Map(itemProperties.map((property) => [property.id, property]))
  const existingPropertyRecordsUids = new Set<string>()
  const staleUids = new Set<string>()
  const revokedAtUpdates = new Map<string, number | null>()
  // Rows whose attestation EAS now reports revoked while the seed is live: retracted (ADR 0021)
  const retractedUids = new Set<string>()

  for (const row of storedRows) {
    if (!row.uid) continue
    const canonical = canonicalByUid.get(row.uid)
    if (!canonical) {
      staleUids.add(row.uid)
      continue
    }
    existingPropertyRecordsUids.add(row.uid)
    // Same policy as seeds and versions: a local unpublish stamp stays until EAS reports a
    // revocationTime, even while EAS (its index lagging) still reports the attestation live.
    const revokedAt = syncedRevokedAt(canonical, row.revokedAt)
    if ((row.revokedAt ?? null) !== revokedAt) {
      revokedAtUpdates.set(row.uid, revokedAt)
      if (revokedAt != null && isRetracted(canonical, itemSeeds, state)) retractedUids.add(row.uid)
    }
  }

  const newProperties = itemProperties.filter(
    (property) => !existingPropertyRecordsUids.has(property.id),
  )

  // Insert before deleting, so a property never goes without a row in between.
  if (newProperties.length > 0) {
    await insertSyncedProperties({ newProperties, itemSeeds, state })
  }

  if (staleUids.size > 0) {
    await writeInBatches([...staleUids], (chunk) =>
      appDb.delete(metadata).where(inArray(metadata.uid, chunk)),
    )
  }

  for (const [uid, revokedAt] of revokedAtUpdates) {
    await appDb
      .update(metadata)
      .set({
        revokedAt,
        ...(retractedUids.has(uid) && {
          propertyValue: null,
          refSeedType: null,
          refResolvedValue: null,
          refResolvedDisplayValue: null,
        }),
      })
      .where(eq(metadata.uid, uid))
  }

  await syncDerivedStorageRows({ fetchedProperties, canonicalProperties: itemProperties })

  return { propertyUids }
}

/** The transaction id a `storage_transaction_id` attestation carries; undefined for other properties. */
const storageTransactionIdOf = (property: Attestation): string | undefined => {
  const parsed = parseEasPropertyMetadata(property.decodedDataJson)
  if (!parsed.ok || parsed.metadata.name !== 'storage_transaction_id') return undefined
  const { value } = parsed.metadata
  // Same serialization as the derived rows' property_value.
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Make derived ItemStorage rows follow their `storage_transaction_id` attestation the way synced
 * rows follow theirs. Derived rows are identified by `derived_from_uid`, the attestation they were
 * derived from:
 * - A row derived from another fetched attestation with the canonical one's transaction id (on the
 *   same version) is pointed at the canonical one; creation makes one row per transaction id.
 * - Rows derived from a fetched attestation that isn't canonical are deleted.
 * - Rows derived from the canonical one take its `revoked_at` once it has one (a stamp is never
 *   cleared, see `syncedRevokedAt`).
 * Local drafts (no uid, no `derived_from_uid`) are never touched.
 */
const syncDerivedStorageRows = async ({
  fetchedProperties,
  canonicalProperties,
}: {
  fetchedProperties: Attestation[]
  canonicalProperties: Attestation[]
}): Promise<void> => {
  const canonical = canonicalProperties
    .map((property) => ({ property, transactionId: storageTransactionIdOf(property) }))
    .filter((c): c is { property: Attestation; transactionId: string } => !!c.transactionId)
  const canonicalUids = new Set(canonicalProperties.map((property) => property.id))

  const appDb = BaseDb.getAppDb()

  for (const { property, transactionId } of canonical) {
    const sameTransaction = fetchedProperties
      .filter(
        (other) =>
          other.id !== property.id &&
          other.refUID === property.refUID &&
          storageTransactionIdOf(other) === transactionId,
      )
      .map((other) => other.id)
    if (sameTransaction.length === 0) continue
    // A stamp belongs to the attestation it came from; the new source's is applied below.
    await writeInBatches(sameTransaction, (chunk) =>
      appDb
        .update(metadata)
        .set({
          derivedFromUid: property.id,
          revokedAt: null,
          attestationCreatedAt: property.timeCreated * 1000,
        })
        .where(inArray(metadata.derivedFromUid, chunk)),
    )
  }

  const staleSourceUids = fetchedProperties
    .filter((property) => !canonicalUids.has(property.id) && storageTransactionIdOf(property))
    .map((property) => property.id)
  if (staleSourceUids.length > 0) {
    await writeInBatches(staleSourceUids, (chunk) =>
      appDb.delete(metadata).where(inArray(metadata.derivedFromUid, chunk)),
    )
  }

  if (canonical.length === 0) return

  // The canonical rows' revoked_at as just stored (the saves above already applied EAS's state).
  const sourceRows: Pick<MetadataType, 'uid' | 'revokedAt'>[] = await selectInBatches(
    canonical.map((c) => c.property.id),
    (chunk) =>
      appDb
        .select({ uid: metadata.uid, revokedAt: metadata.revokedAt })
        .from(metadata)
        .where(inArray(metadata.uid, chunk)),
  )
  const revokedAtByUid = new Map(sourceRows.map((row) => [row.uid, row.revokedAt ?? null]))

  for (const { property } of canonical) {
    const revokedAt = revokedAtByUid.get(property.id) ?? null
    // The source's revoked_at already follows `syncedRevokedAt`. A live source leaves a derived
    // row's stamp alone: like a stamped synced row, it is only replaced by a revocation time.
    if (revokedAt == null) continue
    await appDb
      .update(metadata)
      .set({ revokedAt })
      .where(
        and(
          eq(metadata.derivedFromUid, property.id),
          or(isNull(metadata.revokedAt), ne(metadata.revokedAt, revokedAt)),
        ),
      )
  }
}

/**
 * The cached Model of a synced seed: its own model (seeds.model_file_id) when it has one, else by
 * EAS schema name, the snake_case model name (`sync_storage_post` → SyncStoragePost; a
 * `startCase` lookup never matched multi-word names). Throws AmbiguousModelError when several
 * schemas define a model with that name; callers skip the seed (skipSeedOnAmbiguousModel).
 */
const resolveSyncedSeedModel = async (
  Model: typeof import('../../Model/Model').Model,
  modelType: string,
  seed: { seedLocalId?: string | null; seedUid?: string | null },
) => {
  const modelFileId = await resolveItemModelFileId(seed)
  return (modelFileId ? Model.peek(modelFileId) : undefined) ?? Model.findByModelType(modelType)
}

const insertSyncedProperties = async ({
  newProperties,
  itemSeeds,
  state,
}: {
  newProperties: Attestation[]
  itemSeeds: Attestation[]
  state: SyncRunState
}): Promise<void> => {
  const { seedUidToLocalId, seedUidToModelType, versionUidToLocalId, versionUidToSeedUid } = state

  // Dynamic import to break circular dependency
  const modelMod = await import('../../Model/Model')
  const { Model } = modelMod
  // Loads every model into Model's cache, where resolveSyncedSeedModel looks them up.
  await Model.all()

  const appDb = BaseDb.getAppDb()

  // Bound as parameters, in batches of rowsPerInsert(metadata) rows, so no statement exceeds
  // SQLite's parameter or statement-length limits however many properties a sync stores.
  const rows: (typeof metadata.$inferInsert)[] = []

  for (const property of newProperties) {
    const propertyLocalId = generateId()
    
    // Validate and parse decodedDataJson
    const parsed = parseEasPropertyMetadata(property.decodedDataJson)
    if (!parsed.ok) {
      if (parsed.reason === 'empty') {
        console.warn(
          '[item/events] [syncDbWithEas] empty decodedDataJson for property: ',
          property.id,
        )
      } else if (parsed.reason === 'parse') {
        console.warn(
          '[item/events] [syncDbWithEas] failed to parse decodedDataJson for property: ',
          property.id,
          parsed.error,
        )
      } else {
        console.warn(
          '[item/events] [syncDbWithEas] invalid decodedDataJson structure for property: ',
          property.id,
        )
      }
      continue
    }

    const propertyMetadata = parsed.metadata

    const propertyNameSnake = propertyMetadata.name

    if (!propertyNameSnake) {
      console.warn(
        '[item/events] [syncDbWithEas] no propertyName found for property: ',
        property,
      )
      continue
    }

    let refSeedType: string | undefined
    let refSchemaUid
    const schemaUid = property.schemaId

    const easDataType = propertyMetadata.type
    // A one-field attestation's schema is exactly `<type> <name>`.
    if (easDataType) setSchemaUidForSchemaDefinition({ text: `${easDataType} ${propertyNameSnake}`, schemaUid })
    const versionUid = property.refUID
    const versionLocalId = versionUidToLocalId.get(versionUid)
    const attestationCreatedAt = property.timeCreated * 1000
    const seedUid = versionUidToSeedUid.get(versionUid)
    const seedLocalId = seedUidToLocalId.get(seedUid!)
    const modelType = seedUidToModelType.get(seedUid!)

    const modelSchema = await modelSchemaForSyncedProperty(Model, property, state)

    // ADR 0008: the local property this EAS name stands for, and whether it's a relation.
    const resolvedName = resolveSyncedPropertyName(
      propertyNameSnake,
      propertyMetadata.value,
      modelSchema,
      easDataType,
    )
    if (!resolvedName) continue
    const { propertyName, isRelation, isList } = resolvedName
    const refValueType = isRelation && isList ? 'list' : undefined
    if (isList) refSeedType = resolvedName.refSeedType

    // A reference slot the publisher's contract call never filled names no seed (isUnfilledReference):
    // a relation holding one is skipped, and a list keeps its other members.
    if (isRelation && !isList && isUnfilledReference(propertyMetadata.value)) {
      console.warn(
        `[item/events] [syncDbWithEas] EAS property "${propertyNameSnake}" holds an unfilled reference (${propertyMetadata.value}); skipping it`,
      )
      continue
    }
    if (isRelation && isList && Array.isArray(propertyMetadata.value)) {
      propertyMetadata.value = (propertyMetadata.value as string[]).filter((v) => !isUnfilledReference(v))
    }

    // A removal or a retraction (ADR 0021) is stored as no value, so it is the property's newest row
    const cleared =
      isEasEmptyValue(easDataType, propertyMetadata.value) || isRetracted(property, itemSeeds, state)

    // ADR 0010: numeric values decoded (Number as a decimal string, Date as ISO).
    const decodedValue = cleared
      ? null
      : syncedPropertyValue(resolvedName.dataType, easDataType, propertyMetadata.value)
    if (decodedValue === undefined) {
      console.warn(
        `[item/events] [syncDbWithEas] EAS property "${propertyNameSnake}" has a value that isn't a valid ${resolvedName.dataType}; skipping it`,
      )
      continue
    }

    const propertyValue =
      decodedValue === null ? null : typeof decodedValue === 'string' ? decodedValue : JSON.stringify(decodedValue)

    if (isRelation && !isList && !cleared) {
      const relatedSeed = itemSeeds.find(
        (seed: Attestation) => seed.id === propertyMetadata.value,
      )
      if (relatedSeed && relatedSeed.schema && relatedSeed.schema.schemaNames) {
        refSeedType = relatedSeed.schema.schemaNames[0].name
        refSchemaUid = relatedSeed.schemaId
      }
    }

    if (isRelation && isList && !cleared) {
      const relatedSeeds = itemSeeds.filter((seed: Attestation) =>
        (propertyMetadata.value as string[]).includes(seed.id),
      )
      if (relatedSeeds && relatedSeeds.length > 0) {
        refSeedType = relatedSeeds[0].schema.schemaNames[0].name
        refSchemaUid = relatedSeeds[0].schemaId
      }
    }

    if (propertyNameSnake === 'storage_transaction_id') {
      await createMetadataRecordsForStorageTransactionId(property, modelSchema, state)
    }

    const propertyId =
      (await skipSeedOnAmbiguousModel({ seedLocalId, seedUid }, 'easSync.metadata', async () =>
        resolveMetadataPropertyId({
          definitionId: resolvedName.definitionId,
          propertyName,
          // EAS identifies models by name only; a locally-created seed still knows its model.
          modelName: modelType,
          seedLocalId,
          seedUid,
        }),
      )) ?? null
    rows.push({
      localId: propertyLocalId,
      uid: property.id,
      schemaUid: property.schemaId,
      propertyId,
      propertyName,
      propertyValue,
      easDataType,
      versionUid,
      versionLocalId: versionLocalId ?? null,
      seedUid: seedUid ?? null,
      seedLocalId: seedLocalId ?? null,
      modelType: modelType ?? null,
      refValueType: refValueType || null,
      refSeedType: refSeedType || null,
      refModelUid: refSchemaUid || null,
      attestationCreatedAt,
      attestationRaw: JSON.stringify(property),
      publisher: property.attester ? normalizeHexAddress(property.attester) : '',
      revokedAt: revokedAtSeconds(property) ?? null,
    })
  }

  // No conflict clause, as before: every row has a fresh local_id, and callers pass only
  // attestations with no stored row.
  const batchSize = rowsPerInsert(metadata)
  for (let i = 0; i < rows.length; i += batchSize) {
    await appDb.insert(metadata).values(rows.slice(i, i + batchSize))
  }
  // A local draft of a synced property stays its value, and the conflict is recorded (ADR 0019)
  const { keepLocalDraftsOverSyncedRows } = await import('@/outbox/conflicts')
  await keepLocalDraftsOverSyncedRows(rows)
}

const saveEasPropertiesToDb: SaveEasPropertiesToDb = (params) => {
  const next = saveEasPropertiesDbChain.then(() => saveEasPropertiesToDbBody(params))
  saveEasPropertiesDbChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/**
 * Fetch every version of `seedUids` and every property attestation of those versions, and store
 * them. The main sync and the related-seed fetch both go through here, so they treat revocation
 * the same way: revoked attestations are fetched on purpose (`excludeRevoked: false`), revoked
 * seeds record `revokedAt` (in `saveEasSeedsToDb`), and properties go through the canonical pick
 * (newest non-revoked per version and property schema, see ADR 0006).
 */
const syncVersionsAndPropertiesForSeeds = async ({
  seedUids,
  itemSeeds,
  state,
}: {
  seedUids: string[]
  itemSeeds: Attestation[]
  state: SyncRunState
}): Promise<void> => {
  if (seedUids.length === 0) return

  // Only the seed's attester can add versions to it, and only a version's attester can add
  // properties to it (see partitionByRefAttester): anyone can attest with any refUID.
  const fetchedVersions = await getItemVersionsFromEas({
    seedUids,
    excludeRevoked: false,
  })
  const { kept: itemVersions } = partitionByRefAttester(
    fetchedVersions,
    itemSeeds,
  )

  const { versionUids } = await saveEasVersionsToDb({
    itemVersions,
    state,
  })

  if (versionUids.length > 0) {
    const allProperties = await getItemPropertiesFromEas({
      versionUids,
      excludeRevoked: false,
    })
    const { kept: keptProperties } = partitionByRefAttester(allProperties, itemVersions)

    // The save makes the canonical pick; it also needs the other attestations to clean up after them.
    await saveEasPropertiesToDb({
      fetchedProperties: keptProperties,
      itemSeeds,
      state,
    })
  }
}

/**
 * Relation targets of synced properties, fetched by id from any attester (one level deep).
 *
 * This deliberately matches the main sync instead of filtering out revoked attestations: a
 * relation to an unpublished seed should still resolve locally, to the seed's last values next to
 * its `revokedAt`, exactly as if that seed had been synced in its own right. Filtering at the query
 * would also break the canonical pick, which needs the revoked attestations to skip them (or to
 * keep the newest one when all are revoked), and would leave `seeds.revoked_at` unset.
 */
const getRelatedSeedsAndVersions = async (state: SyncRunState) => {
  // Snapshot: relations found on the related seeds themselves aren't followed (one level deep).
  const uids = Array.from(state.relatedSeedUids)
  if (uids.length === 0) return

  const easClient = BaseEasClient.getEasClient()

  // No `revoked` filter, like `getSeedsFromSchemaUids({ excludeRevoked: false })` in the main sync.
  const { itemSeeds } = await easClient.request(GET_SEEDS, {
    where: {
      id: {
        in: uids,
      },
    },
  })

  const { seedUids } = await saveEasSeedsToDb({ itemSeeds, state })

  // Only seeds EAS returned: a version of an unknown seed would be stored without its seed.
  await syncVersionsAndPropertiesForSeeds({ seedUids, itemSeeds, state })
}

export type SyncFromEasOptions = {
  /** Override addresses to sync. Default: owned + watched from DB. */
  addresses?: string[]
}

/**
 * Core sync logic: fetches item attestations from EAS for configured models and given addresses,
 * then saves seeds, versions, and properties to the local DB.
 * Uses owned + watched addresses from DB when addresses are not provided.
 */
export const runSyncFromEas = async (options?: SyncFromEasOptions): Promise<void> => {
  let addresses = options?.addresses ?? (await getAllAddressesFromDb())
  const additionalGetter = getGetAdditionalSyncAddresses()
  if (additionalGetter) {
    const additional = await additionalGetter()
    if (additional?.length) {
      const seen = new Set(addresses.map((a) => a.toLowerCase()))
      for (const addr of additional) {
        if (addr && !seen.has(addr.toLowerCase())) {
          seen.add(addr.toLowerCase())
          addresses = [...addresses, addr]
        }
      }
    }
  }
  if (!addresses || addresses.length === 0) {
    return
  }

  // Don't read the default chain while publish is about to configure another one.
  await waitForEasReadChain()
  // Never mix attestations from two chains in one local DB.
  await assertLocalDbChain()

  const appDb = BaseDb.getAppDb()

  // ADR 0009: this run matches names at the levels the stored schema files set now.
  await loadNameMatchLevels(appDb)

  // ADR 0008: matched by name, so seeds published under an older SDK's name are found too. Schemas
  // that match no local model (e.g. "bytes32 image" with no Image model) aren't fetched.
  const modelSchemaLookups = await localModelSchemaLookups()
  const modelSchemaMatches = matchEasModelSchemas(await getModelSchemasFromEas(modelSchemaLookups), modelSchemaLookups)
  // The same rule as init: only each model's exact schema goes into model_uids.
  await writeModelUids(modelSchemaMatches, appDb)
  const schemaUids = [...new Set(modelSchemaMatches.map((match) => match.schema.id))]

  // If no schemas were found, skip the rest of the sync process
  // This can happen when models exist but don't have schemas registered in EAS yet
  if (schemaUids.length === 0) {
    return
  }

  const itemSeeds = await getSeedsFromSchemaUids({
    schemaUids,
    addresses,
    excludeRevoked: false,
  })

  const state = createSyncRunState()

  const { seedUids } = await saveEasSeedsToDb({
    itemSeeds,
    state,
  })

  await syncVersionsAndPropertiesForSeeds({ seedUids, itemSeeds, state })

  await getRelatedSeedsAndVersions(state)
  scheduleBulkFilesDownloadFromEasSync(addresses)

  // Loaded items in the browser see sync's writes through the change feed (ADR 0020); Node has none.
  if (!isBrowser()) {
    try {
      const itemMod = await import('../../Item/Item')
      await itemMod.Item.rehydrateCachedItemsFromDbAfterEasSync()
    } catch (err) {
      console.warn('[item/events] [syncDbWithEas] rehydrateCachedItemsFromDbAfterEasSync:', err)
    }
  }
  emitAcrossTabs(EAS_SEED_DATA_SYNCED_TO_DB_EVENT)
}

