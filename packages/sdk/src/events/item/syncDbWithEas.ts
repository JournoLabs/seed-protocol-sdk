import { resolveItemModelFileId } from '@/db/read/resolveModelRecord'
import { resolveModelForSyncedSeed, skipSeedOnAmbiguousModel } from '@/db/read/resolveModelForSyncedSeed'
import { camelCase, startCase } from 'lodash-es'
import { Attestation, SchemaWhereInput } from '@seedprotocol/eas'
import {
  parseEasPropertyMetadata,
  parseEasRelationPropertyName,
} from '@seedprotocol/query'
import {
  metadata,
  MetadataType,
  modelUids,
  seeds,
  SeedType,
  versions,
  VersionsType,
} from '@/seedSchema'
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import {
  generateId,
} from '@/helpers'
import { modelPropertiesToObject } from '@/helpers/model'
import { GET_SEEDS } from '@seedprotocol/eas'
import { escapeSqliteString, getAllAddressesFromDb, getPropertyIdForModelAndName } from '@/helpers/db'
// Dynamic import to break circular dependency: Model -> BaseItem -> ... -> syncDbWithEas -> Model
// import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { getModelSchemas } from '@/db/read/getModelSchemas'
import { ModelSchema, PropertyType } from '@/types'
import { createSeeds } from '@/db/write/createSeeds'
import { normalizeHexAddress } from '@/helpers/addresses'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { setSchemaUidForSchemaDefinition } from '@/stores/eas'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import {
  getItemPropertiesFromEas,
  getItemVersionsFromEas,
  getModelSchemasFromEas,
  getSeedsFromSchemaUids,
} from '@/eas'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@/helpers/easPropertyCanonical'
import { getGetAdditionalSyncAddresses } from '@/helpers/publishConfig'
import { scheduleBulkFilesDownloadFromEasSync } from '@/events/files/download'
import { eventEmitter } from '@/eventBus'
import { assertLocalDbChain, waitForEasReadChain } from '@/helpers/localDbChain'
import { EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@/helpers/constants'

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
 * `revoked_at` to store for an attestation that already has a row (seed or version), given the
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

const relationValuesToExclude = [
  '0x0000000000000000000000000000000000000000000000000000000000000020',
]


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

/**
 * Seed UIDs that relation properties point at. Collected from every property the run fetched, not
 * only newly stored ones, so related seeds are refreshed (new versions, revocations) on each sync.
 */
const collectRelatedSeedUids = (properties: Attestation[], into: Set<string>): void => {
  for (const property of properties) {
    const parsed = parseEasPropertyMetadata(property.decodedDataJson)
    if (!parsed.ok) continue
    const { name, value } = parsed.metadata
    if (!name || !isRelationPropertyName(name)) continue
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (typeof v === 'string' && v && !relationValuesToExclude.includes(v)) into.add(v)
    }
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
  const appDb = BaseDb.getAppDb()

  const seedUids = itemSeeds.map((seed) => seed.id)

  const existingSeedRecordsRows: SeedType[] = await appDb
    .select()
    .from(seeds)
    .where(inArray(seeds.uid, seedUids))

  const existingSeedUids = new Set<string>()

  if (existingSeedRecordsRows && existingSeedRecordsRows.length > 0) {
    for (const row of existingSeedRecordsRows) {
      if (row.uid) {
        existingSeedUids.add(row.uid)
        if (row.localId) {
          seedUidToLocalId.set(row.uid, row.localId)
        }
        if (row.type) {
          seedUidToModelType.set(row.uid, row.type)
        }
      }
    }
  }

  const newSeeds = itemSeeds.filter((seed) => !existingSeedUids.has(seed.id))

  // Update existing seeds when attestations are revoked on EAS, and replace a local unpublish stamp
  // with EAS's revocationTime once EAS reports one (see `syncedRevokedAt`).
  const seedByUid = new Map(itemSeeds.map((s) => [s.id, s]))
  for (const row of existingSeedRecordsRows) {
    if (!row.uid || !row.localId) continue
    const attestation = seedByUid.get(row.uid)
    if (!attestation) continue
    const revokedAt = syncedRevokedAt(attestation, row.revokedAt)
    if (revokedAt == null || revokedAt === row.revokedAt) continue
    await updateSeedRevokedAt({ seedLocalId: row.localId, revokedAt })
  }

  if (newSeeds.length === 0) {
    return { seedUids }
  }

  const newSeedsData: Partial<SeedType>[] = []

  for (let i = 0; i < newSeeds.length; i++) {
    const seed = newSeeds[i]
    seedUidToModelType.set(seed.id, seed.schema.schemaNames[0].name)
    const seedLocalId = generateId()
    seedUidToLocalId.set(seed.id, seedLocalId)

    const attestationRaw = escapeSqliteString(JSON.stringify(seed))
    const revokedAt = revokedAtSeconds(seed)

    // EAS only knows the model by name; the seam may match it to a local model (not built yet).
    const modelFileId = await resolveModelForSyncedSeed({
      seedUid: seed.id,
      seedLocalId,
      modelType: seed.schema.schemaNames[0].name,
      schemaUid: seed.schemaId,
    })

    newSeedsData.push({
      localId: seedLocalId,
      uid: seed.id,
      schemaUid: seed.schemaId,
      type: seed.schema.schemaNames[0].name,
      ...(modelFileId && { modelFileId }),
      publisher: seed.attester ? normalizeHexAddress(seed.attester) : seed.attester,
      createdAt: Date.now(),
      attestationCreatedAt: seed.timeCreated * 1000,
      attestationRaw,
      ...(revokedAt !== undefined && { revokedAt }),
    })
  }

  await createSeeds(newSeedsData)

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

/** Rows per versions INSERT (about 10 bound parameters each). */
const VERSION_INSERT_BATCH = 50

const saveEasVersionsToDb: SaveEasVersionsToDb = async ({ itemVersions, state }) => {
  const { seedUidToLocalId, seedUidToModelType, versionUidToLocalId, versionUidToSeedUid } = state
  const versionUids = itemVersions.map((version) => version.id)

  const appDb = BaseDb.getAppDb()

  const existingVersionRecordsRows: VersionsType[] = await appDb
    .select()
    .from(versions)
    .where(inArray(versions.uid, versionUids))

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
            .set({ revokedAt, updatedAt: Date.now() })
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
      createdAt: Date.now(),
      attestationCreatedAt: version.timeCreated * 1000,
      attestationRaw: JSON.stringify(version),
      publisher: version.attester ? normalizeHexAddress(version.attester) : '',
      revokedAt: revokedAtSeconds(version) ?? null,
    })
  }

  // Bound parameters: keep each statement well under SQLite's host-parameter limit.
  for (let i = 0; i < rows.length; i += VERSION_INSERT_BATCH) {
    await appDb.insert(versions).values(rows.slice(i, i + VERSION_INSERT_BATCH))
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
  // Early return if modelSchema is not provided
  if (!modelSchema) {
    console.warn(
      '[item/events] [syncDbWithEas] modelSchema is undefined for storageTransactionIdProperty: ',
      storageTransactionIdProperty.id,
    )
    return
  }

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
  const propertyName = camelCase(attestationData.name)
  const propertyValue =
    typeof attestationData.value === 'string'
      ? attestationData.value
      : JSON.stringify(attestationData.value)

  const itemStorageProperties = new Map<string, PropertyType>()

  for (const [_propertyName, propertyDef] of Object.entries(modelSchema)) {
    if (propertyDef?.storageType && propertyDef.storageType === 'ItemStorage') {
      itemStorageProperties.set(_propertyName, propertyDef)
    }
  }

  if (itemStorageProperties.size === 0) {
    return
  }

  const appDb = BaseDb.getAppDb()

  for (const [_propertyName, propertyDef] of itemStorageProperties.entries()) {
    const existingMetadataRecordRows = await appDb
      .select()
      .from(metadata)
      .where(
        and(
          eq(metadata.propertyName, _propertyName),
          eq(metadata.propertyValue, propertyValue),
          eq(metadata.versionUid, storageTransactionIdProperty.refUID),
        ),
      )

    if (existingMetadataRecordRows && existingMetadataRecordRows.length > 0) {
      continue
    }

    const seedUid = versionUidToSeedUid.get(
      storageTransactionIdProperty.refUID,
    ) as string
    const seedLocalId = seedUidToLocalId.get(seedUid)
    const versionUid = storageTransactionIdProperty.refUID
    const versionLocalId = versionUidToLocalId.get(versionUid)
    const modelType = seedUidToModelType.get(seedUid)
    const propertyId =
      modelType != null
        ? ((await skipSeedOnAmbiguousModel({ seedLocalId, seedUid }, 'easSync.storageTransactionId', async () =>
            getPropertyIdForModelAndName(modelType, _propertyName, {
              modelFileId: await resolveItemModelFileId({ seedLocalId, seedUid }),
            }),
          )) ?? null)
        : null

    const propertyLocalId = generateId()
    await appDb.insert(metadata).values({
      localId: propertyLocalId,
      propertyId: propertyId ?? undefined,
      propertyName: _propertyName,
      propertyValue,
      localStorageDir: propertyDef.localStorageDir,
      seedLocalId,
      seedUid,
      versionLocalId,
      versionUid,
      refValueType: 'file',
      refResolvedValue: `${propertyValue}${propertyDef.filenameSuffix}`,
      modelType: seedUidToModelType.get(seedUid),
      createdAt: Date.now(),
      updatedAt: Date.now(),
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

  collectRelatedSeedUids(itemProperties, state.relatedSeedUids)

  const appDb = BaseDb.getAppDb()

  const storedRows: Pick<MetadataType, 'uid' | 'revokedAt'>[] = await appDb
    .select({ uid: metadata.uid, revokedAt: metadata.revokedAt })
    .from(metadata)
    .where(inArray(metadata.uid, fetchedProperties.map((property) => property.id)))

  const canonicalByUid = new Map(itemProperties.map((property) => [property.id, property]))
  const existingPropertyRecordsUids = new Set<string>()
  const staleUids = new Set<string>()
  const revokedAtUpdates = new Map<string, number | null>()

  for (const row of storedRows) {
    if (!row.uid) continue
    const canonical = canonicalByUid.get(row.uid)
    if (!canonical) {
      staleUids.add(row.uid)
      continue
    }
    existingPropertyRecordsUids.add(row.uid)
    // Keep a stored revocation time when EAS has none (local unpublish records its own).
    const revokedAt =
      canonical.revoked && !(canonical.revocationTime > 0) && row.revokedAt != null
        ? row.revokedAt
        : (revokedAtSeconds(canonical) ?? null)
    if ((row.revokedAt ?? null) !== revokedAt) {
      revokedAtUpdates.set(row.uid, revokedAt)
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
    await appDb.delete(metadata).where(inArray(metadata.uid, [...staleUids]))
  }

  for (const [uid, revokedAt] of revokedAtUpdates) {
    await appDb
      .update(metadata)
      .set({ revokedAt, updatedAt: Date.now() })
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
 * Rows `createMetadataRecordsForStorageTransactionId` derived from a `storage_transaction_id`
 * attestation. They have no uid of their own; what identifies them is what they're derived from,
 * the key their creation dedupes on: no uid, `ref_value_type` 'file', the attestation's version
 * and its transaction id as the value. Local edits of an ItemStorage property store a file name
 * (`<seed>.<ext>`), never a bare transaction id, so they don't match.
 */
const derivedStorageRowsWhere = (versionUid: string, transactionId: string) =>
  and(
    isNull(metadata.uid),
    eq(metadata.refValueType, 'file'),
    eq(metadata.versionUid, versionUid),
    eq(metadata.propertyValue, transactionId),
  )

/**
 * Make derived ItemStorage rows follow their `storage_transaction_id` attestation the way synced
 * rows follow theirs: rows derived from a fetched attestation that isn't canonical are deleted
 * (unless the canonical one carries the same transaction id), and rows derived from the canonical
 * one take its `revoked_at`.
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
  const canonicalTransactionIds = new Set(
    canonical.map((c) => `${c.property.refUID}|${c.transactionId}`),
  )

  const appDb = BaseDb.getAppDb()

  for (const property of fetchedProperties) {
    if (canonicalUids.has(property.id)) continue
    const transactionId = storageTransactionIdOf(property)
    if (!transactionId) continue
    if (canonicalTransactionIds.has(`${property.refUID}|${transactionId}`)) continue
    await appDb.delete(metadata).where(derivedStorageRowsWhere(property.refUID, transactionId))
  }

  if (canonical.length === 0) return

  // The canonical rows' revoked_at as just stored (the saves above already applied EAS's state).
  const sourceRows: Pick<MetadataType, 'uid' | 'revokedAt'>[] = await appDb
    .select({ uid: metadata.uid, revokedAt: metadata.revokedAt })
    .from(metadata)
    .where(inArray(metadata.uid, canonical.map((c) => c.property.id)))
  const revokedAtByUid = new Map(sourceRows.map((row) => [row.uid, row.revokedAt ?? null]))

  for (const { property, transactionId } of canonical) {
    if (!revokedAtByUid.has(property.id)) continue
    const revokedAt = revokedAtByUid.get(property.id) ?? null
    await appDb
      .update(metadata)
      .set({ revokedAt, updatedAt: Date.now() })
      .where(
        and(
          derivedStorageRowsWhere(property.refUID, transactionId),
          revokedAt == null
            ? isNotNull(metadata.revokedAt)
            : or(isNull(metadata.revokedAt), ne(metadata.revokedAt, revokedAt)),
        ),
      )
  }
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
  const allModels = await Model.all()
  const models = Object.fromEntries(allModels.map(m => [m.modelName!, m]))

  const appDb = BaseDb.getAppDb()

  let insertPropertiesQuery = `INSERT INTO metadata (local_id, uid, schema_uid, property_id, property_name, property_value,
                                                     eas_data_type, version_uid, version_local_id, seed_uid,
                                                     seed_local_id, model_type, ref_value_type, ref_seed_type,
                                                     ref_schema_uid,
                                                     created_at, attestation_created_at, attestation_raw,
                                                     local_storage_dir, ref_resolved_value, publisher,
                                                     revoked_at)
  VALUES `

  for (let i = 0; i < newProperties.length; i++) {
    const property = newProperties[i]
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

    let propertyNameSnake = propertyMetadata.name

    if (!propertyNameSnake) {
      console.warn(
        '[item/events] [syncDbWithEas] no propertyName found for property: ',
        property,
      )
      continue
    }

    let isRelation = false
    let refValueType
    let refSeedType
    let refSchemaUid
    let refResolvedValue
    let isList = false
    const schemaUid = property.schemaId

    setSchemaUidForSchemaDefinition({
      text: propertyNameSnake,
      schemaUid,
    })

    if (isRelationPropertyName(propertyNameSnake)) {
      isRelation = true

      if (Array.isArray(propertyMetadata.value)) {
        isList = true
        refValueType = 'list'

        const result = parseEasRelationPropertyName(propertyNameSnake)

        if (result) {
          propertyNameSnake = result.propertyName
          refSeedType = result.modelName
        }

      }

      if (!isList) {
        if (relationValuesToExclude.includes(propertyMetadata.value as string)) {
          continue
        }
      }
    }

    let propertyValue = propertyMetadata.value

    if (typeof propertyValue !== 'string') {
      propertyValue = JSON.stringify(propertyValue)
    }

    if (isRelation && !isList) {
      const relatedSeed = itemSeeds.find(
        (seed: Attestation) => seed.id === propertyMetadata.value,
      )
      if (relatedSeed && relatedSeed.schema && relatedSeed.schema.schemaNames) {
        refSeedType = relatedSeed.schema.schemaNames[0].name
        refSchemaUid = relatedSeed.schemaId
      }
    }

    if (isRelation && isList) {
      const relatedSeeds = itemSeeds.filter((seed: Attestation) =>
        (propertyMetadata.value as string[]).includes(seed.id),
      )
      if (relatedSeeds && relatedSeeds.length > 0) {
        refSeedType = relatedSeeds[0].schema.schemaNames[0].name
        refSchemaUid = relatedSeeds[0].schemaId
      }
    }

    const propertyName = camelCase(propertyNameSnake)
    propertyValue = escapeSqliteString(propertyValue)
    const easDataType = propertyMetadata.type
    const versionUid = property.refUID
    const versionLocalId = versionUidToLocalId.get(versionUid)
    const attestationCreatedAt = property.timeCreated * 1000
    const attestationRaw = escapeSqliteString(JSON.stringify(property))
    const seedUid = versionUidToSeedUid.get(versionUid)
    const seedLocalId = seedUidToLocalId.get(seedUid!)
    const modelType = seedUidToModelType.get(seedUid!)

    let localStorageDir
    const modelName = startCase(modelType)
    const model = models[modelName]
    const modelSchema = model?.properties ? modelPropertiesToObject(model.properties) : undefined

    if (propertyNameSnake === 'storage_transaction_id') {
      await createMetadataRecordsForStorageTransactionId(property, modelSchema, state)
    }

    const propertyId =
      modelType != null
        ? ((await skipSeedOnAmbiguousModel({ seedLocalId, seedUid }, 'easSync.metadata', async () =>
            getPropertyIdForModelAndName(modelType, propertyName, {
              // EAS identifies models by name only; a locally-created seed still knows its model.
              modelFileId: await resolveItemModelFileId({ seedLocalId, seedUid }),
            }),
          )) ?? null)
        : null
    const propertyIdSql = propertyId != null ? String(propertyId) : 'NULL'

    const publisher = escapeSqliteString(
      property.attester ? normalizeHexAddress(property.attester) : '',
    )
    const valuesString = `('${propertyLocalId}', '${property.id}', 
                         '${property.schemaId}', ${propertyIdSql}, '${propertyName}', 
                         '${propertyValue}', '${easDataType}', '${versionUid}', 
                         '${versionLocalId}', '${seedUid}', '${seedLocalId}', 
                         '${modelType}', ${refValueType ? `'${refValueType}'` : 'NULL'}, 
                         ${refSeedType ? `'${refSeedType}'` : 'NULL'},
                         ${refSchemaUid ? `'${refSchemaUid}'` : 'NULL'},
                         ${Date.now()}, ${attestationCreatedAt}, '${attestationRaw}',
                         ${localStorageDir ? `'${localStorageDir}'` : 'NULL'},
                         ${refResolvedValue ? `'${refResolvedValue}'` : 'NULL'},
                         '${publisher}', ${revokedAtSeconds(property) ?? 'NULL'})`

    if (i < newProperties.length - 1) {
      insertPropertiesQuery += valuesString + ', '
    }

    if (i === newProperties.length - 1) {
      insertPropertiesQuery += valuesString + ';'
    }

  }

  if (insertPropertiesQuery.endsWith('VALUES ')) {
    return
  }

  if (insertPropertiesQuery.endsWith(', ')) {
    insertPropertiesQuery = insertPropertiesQuery.slice(0, -2) + ';'
  }

  await appDb.run(sql.raw(insertPropertiesQuery))
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

  const itemVersions = await getItemVersionsFromEas({
    seedUids,
    excludeRevoked: false,
  })

  const { versionUids } = await saveEasVersionsToDb({
    itemVersions,
    state,
  })
  if (versionUids.length === 0) return

  const fetchedProperties = await getItemPropertiesFromEas({
    versionUids,
    excludeRevoked: false,
  })

  // The save makes the canonical pick; it also needs the other attestations to clean up after them.
  await saveEasPropertiesToDb({
    fetchedProperties,
    itemSeeds,
    state,
  })
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

  const { schemaStringToModelRecord } = await getModelSchemas()

  const modelSchemas = await getModelSchemasFromEas()

  const schemaUids: string[] = []

  for (const modelSchema of modelSchemas) {
    const foundModel = schemaStringToModelRecord.get(modelSchema.schema)

    if (!foundModel) {
      // Skip schemas that don't have a corresponding model in the user's config
      // This can happen with "bytes32 image" if there's no Image model defined
      console.warn(
        `[item/events] [syncDbWithEas] Model not found for schema ${modelSchema.schema}, skipping`
      )
      continue
    }

    try {
      await appDb
        .insert(modelUids)
        .values({
          modelId: foundModel.id,
          uid: modelSchema.id,
        })
        .onConflictDoNothing()
    } catch (err: unknown) {
      // Model may have been deleted by test teardown or another process; skip to avoid unhandled rejection
      const e = err as { code?: string; rawCode?: number; cause?: { code?: string; rawCode?: number } }
      const code = e?.code ?? e?.rawCode ?? e?.cause?.code ?? e?.cause?.rawCode
      if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 787) {
        continue
      }
      throw err
    }

    schemaUids.push(modelSchema.id)
  }

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

  try {
    const itemMod = await import('../../Item/Item')
    await itemMod.Item.rehydrateCachedItemsFromDbAfterEasSync()
  } catch (err) {
    console.warn('[item/events] [syncDbWithEas] rehydrateCachedItemsFromDbAfterEasSync:', err)
  }
  eventEmitter.emit(EAS_SEED_DATA_SYNCED_TO_DB_EVENT)
}

