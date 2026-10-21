import { metadata, MetadataType } from '@/seedSchema'
import { and, eq, sql } from 'drizzle-orm'
import { easName } from '@seedprotocol/eas'
import { findSeedRow } from '@/db/read/findSeedRow'
import { getVersionData } from '@/db/read/getVersionData'
import { generateId } from '@/helpers'
import { matchMetadataProperty, metadataRowsOfProperty } from '@/db/read/metadataProperty'
import { METADATA_LATEST_FIRST_ORDER_SQL } from '@/helpers/compareMetadataRowsLatestFirst'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { getSeedPublisher } from '@/db/read/getSeedPublisher'
const logger = debug('seedSdk:write:updateItemPropertyValue')

/**
 * The row that holds the value after the write. `uid` is that row's attestation uid: set only when
 * the value was unchanged and the newest row is published, so a caller can tell a pending draft
 * (no uid) from an attested value. An edit of a published row lands in a new draft row.
 */
type UpdateItemPropertyValueResult = {
  localId: string
  uid: string | null
  schemaUid: string
}

type UpdateItemPropertyValueProps = Partial<MetadataType> & {
  newValue?: string | null
  modelName?: string | null
  dataType?: string
  refValueType?: string
}

type WriteOptions = {
  /**
   * The database or transaction to write (a `BaseDb.transaction` callback's `tx`); the app database
   * by default. Every read this writer makes goes through it too.
   */
  db?: ReturnType<typeof BaseDb.getAppDb>
}

type UpdateItemPropertyValue = (
  props: UpdateItemPropertyValueProps,
  options?: WriteOptions,
) => Promise<UpdateItemPropertyValueResult | undefined>

export const updateItemPropertyValue: UpdateItemPropertyValue = async ({
  localId: localIdParam,
  propertyName,
  newValue,
  seedUid,
  seedLocalId,
  modelName,
  refSeedType,
  refResolvedValue,
  refResolvedDisplayValue,
  versionLocalId,
  versionUid,
  schemaUid,
  localStorageDir,
  dataType,
  refValueType,
}, options = {}) => {
  if (!localIdParam && !seedLocalId) {
    logger(
      `[db/write] [updateItemPropertyValue] no propertyLocalId or seedLocalId for property: ${propertyName}`,
    )
    return
  }

  // Every write below binds parameters: store the value as given (no SQL escaping).
  const safeNewValue = newValue

  const appDb = options.db ?? BaseDb.getAppDb()

  // The property's rows are matched by property_id (decision D4); rows with none by name.
  const property = await matchMetadataProperty(
    {
      propertyName,
      modelName,
      seedLocalId,
      seedUid,
      dataType,
      refValueType: (refValueType ?? refSeedType) ?? undefined,
    },
    appDb,
  )
  const propertyRows = async (seed: string, match: { propertyId?: number | null; names: string[] } = property) =>
    (await appDb
      .select()
      .from(metadata)
      .where(and(metadataRowsOfProperty(match), eq(metadata.seedLocalId, seed)))
      .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))) as (MetadataType & { localId?: string | null })[]

  // Path 1: When localId is provided, query by local_id first (avoids property name mismatch)
  let rows: (MetadataType & { localId?: string | null })[]
  if (localIdParam && seedLocalId) {
    const localIdRows = await appDb
      .select()
      .from(metadata)
      .where(
        and(
          eq(metadata.localId, localIdParam),
          eq(metadata.seedLocalId, seedLocalId),
        ),
      )
    rows = localIdRows as (MetadataType & { localId?: string | null })[]
    // The row may be gone (a draft deleted or replaced): fall back to the property's rows
    if (rows.length === 0) rows = await propertyRows(seedLocalId)
  } else if (localIdParam) {
    const localIdRows = await appDb
      .select()
      .from(metadata)
      .where(eq(metadata.localId, localIdParam))
    rows = localIdRows as (MetadataType & { localId?: string | null })[]
  } else {
    // Path 2: the property's rows
    rows = await propertyRows(seedLocalId!)
  }

  // A localId can name a published row that an edit has since moved off (a property whose context
  // went stale). Compare with, and write to, the property's newest row instead: otherwise every save
  // adds another draft, and setting the published value back looks unchanged and keeps the draft.
  const localIdRow = localIdParam ? rows.find((row) => row.localId === localIdParam) : undefined
  if (localIdRow?.uid && localIdRow.propertyName && localIdRow.seedLocalId) {
    const newestRows = await propertyRows(localIdRow.seedLocalId, {
      propertyId: localIdRow.propertyId ?? property.propertyId,
      names: [localIdRow.propertyName],
    })
    if (newestRows.length > 0) rows = newestRows.slice(0, 1)
  }

  if (rows && rows.length > 0) {
    const {
      localId,
      uid,
      propertyId: propertyIdFromDb,
      propertyName: propertyNameFromDb,
      propertyValue: propertyValueFromDb,
      modelType,
      seedLocalId: seedLocalIdFromDb,
      versionLocalId,
      schemaUid,
      easDataType,
      refSeedType: refSeedTypeFromDb,
      refResolvedValue: refResolvedValueFromDb,
    } = rows[0]

    // Stored model types are the model's EAS name (ADR 0008): `blog_post` for BlogPost.
    const modelTypeForName = modelName ? easName(modelName) : undefined

    if (
      propertyValueFromDb === newValue &&
      modelType === modelTypeForName &&
      // The DB holds null where callers leave a field out (plain values pass no ref fields).
      (refSeedTypeFromDb ?? null) === (refSeedType ?? null) &&
      (refResolvedValueFromDb ?? null) === (refResolvedValue ?? null)
    ) {
      logger(
        `[db/write] [updateItemPropertyValue] value is the same as most recent record for property: ${propertyNameFromDb}`,
      )
      return localId == null ? undefined : { localId, uid: uid ?? null, schemaUid: schemaUid ?? '' }
    }

    // This means we already have a local-only record so we should just update that one
    if (!uid) {
      if (localId == null) return
      // Use Drizzle update API for proper parameterization (avoids SQL injection from filenames with quotes)
      const now = Date.now()
      const updatePayload: Record<string, unknown> = {
        propertyValue: safeNewValue ?? null,
        refSeedType: refSeedType ?? null,
        refResolvedValue: refResolvedValue ?? null,
        refResolvedDisplayValue: refResolvedDisplayValue ?? null,
        // Readers take the newest row by COALESCE(attestation_created_at, created_at), so a draft's
        // time is when its value was last set: a synced value older than this edit mustn't win.
        createdAt: now,
      }
      if (localStorageDir !== undefined) {
        updatePayload.localStorageDir = localStorageDir ?? null
      }
      // A draft written before its property resolved gets its property_id now
      if (propertyIdFromDb == null && property.propertyId != null) {
        updatePayload.propertyId = property.propertyId
      }
      await appDb
        .update(metadata)
        .set(updatePayload as Partial<typeof metadata.$inferInsert>)
        .where(eq(metadata.localId, localId))

      return { localId, uid: null, schemaUid: schemaUid ?? '' }
    }

    const seedDataFromDb = seedLocalId ? await findSeedRow({ localId: seedLocalId }, appDb) : null
    const versionDataFromDb = versionLocalId ? await getVersionData({ localId: versionLocalId }, appDb) : null

    // Here we don't have a local-only record so we need to create a new one
    const newLocalId = generateId()
    // The row belongs to its seed's wallet, like createMetadata's.
    const publisher = await getSeedPublisher(seedLocalIdFromDb ?? seedLocalId, appDb)

    await appDb.insert(metadata).values({
      localId: newLocalId,
      ...(publisher && { publisher }),
      propertyId: propertyIdFromDb ?? property.propertyId,
      // New rows take the property's storage name, whatever the row they replace is stored under
      propertyName: property.property?.storageName ?? propertyNameFromDb,
      propertyValue: safeNewValue ?? null,
      modelType: modelType || modelTypeForName || null,
      seedUid: seedDataFromDb?.uid || null,
      seedLocalId: seedLocalIdFromDb,
      versionLocalId,
      versionUid: versionDataFromDb?.uid || null,
      schemaUid,
      easDataType: easDataType || null,
      refSeedType: refSeedType || null,
      refResolvedValue: refResolvedValue || null,
      refResolvedDisplayValue: refResolvedDisplayValue || null,
      localStorageDir: localStorageDir || null,
    })

    return {
      localId: newLocalId,
      uid: null,
      schemaUid: schemaUid ?? '',
    }
  }

  // Here there are no records for this property on this seed so we should create one

  const newLocalId = generateId()

  if (!seedUid) {
    const seedData = await findSeedRow({ localId: seedLocalId }, appDb)
    if (seedData) {
      seedUid = seedData.uid || undefined
    }
  }

  if (!versionUid) {
    const versionData = await getVersionData({ localId: versionLocalId }, appDb)
    if (versionData) {
      versionUid = versionData.uid
    }
  }

  const publisher = await getSeedPublisher(seedLocalId, appDb)

  await appDb.insert(metadata).values({
    localId: newLocalId,
    ...(publisher && { publisher }),
    propertyId: property.propertyId,
    propertyName: property.property?.storageName ?? propertyName,
    propertyValue: safeNewValue ?? null,
    modelType: modelName ? easName(modelName) : '',
    seedUid: seedUid || null,
    seedLocalId: seedLocalId || '',
    versionLocalId: versionLocalId || '',
    versionUid: versionUid || null,
    schemaUid: schemaUid || '',
    refSeedType: refSeedType || null,
    refResolvedValue: refResolvedValue || null,
    refResolvedDisplayValue: refResolvedDisplayValue || null,
    localStorageDir: localStorageDir || null,
  })

  return {
    localId: newLocalId,
    uid: null,
    schemaUid: schemaUid ?? '',
  }

  if (!seedLocalId && propertyName && modelName && newValue) {
    // TODO: Does this ever happen? If so, what should we do?
  }
}
