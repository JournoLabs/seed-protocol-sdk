import { metadata, MetadataType } from '@/seedSchema'
import { and, eq, or, sql } from 'drizzle-orm'
import { easName } from '@seedprotocol/eas'
import { getSeedData } from '@/db/read/getSeedData'
import { getVersionData } from '@/db/read/getVersionData'
import { generateId } from '@/helpers'
import { getMetadataPropertyNamesForQuery } from '@/helpers/metadataPropertyNames'
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

type UpdateItemPropertyValue = (props: UpdateItemPropertyValueProps) => Promise<UpdateItemPropertyValueResult | undefined>

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
}) => {
  if (!localIdParam && !seedLocalId) {
    logger(
      `[db/write] [updateItemPropertyValue] no propertyLocalId or seedLocalId for property: ${propertyName}`,
    )
    return
  }

  // Every write below binds parameters: store the value as given (no SQL escaping).
  const safeNewValue = newValue

  const appDb = BaseDb.getAppDb()

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
    if (rows.length === 0) {
      // Fallback: row may have been created with different property_name variant
      const names = getMetadataPropertyNamesForQuery(propertyName!, dataType, (refValueType ?? refSeedType) ?? undefined)
      const propertyNameWhere =
        names.length > 1
          ? or(...names.map((n) => eq(metadata.propertyName, n)))
          : eq(metadata.propertyName, names[0])
      rows = (await appDb
        .select()
        .from(metadata)
        .where(and(propertyNameWhere, eq(metadata.seedLocalId, seedLocalId)))
        .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))) as (MetadataType & { localId?: string | null })[]
    }
  } else if (localIdParam) {
    const localIdRows = await appDb
      .select()
      .from(metadata)
      .where(eq(metadata.localId, localIdParam))
    rows = localIdRows as (MetadataType & { localId?: string | null })[]
  } else {
    // Path 2: Query by property name variants (align with read path)
    const names = getMetadataPropertyNamesForQuery(propertyName!, dataType, (refValueType ?? refSeedType) ?? undefined)
    const propertyNameWhere =
      names.length > 1
        ? or(...names.map((n) => eq(metadata.propertyName, n)))
        : eq(metadata.propertyName, names[0])
    rows = (await appDb
      .select()
      .from(metadata)
      .where(and(propertyNameWhere, eq(metadata.seedLocalId, seedLocalId!)))
      .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))) as (MetadataType & { localId?: string | null })[]
  }

  // A localId can name a published row that an edit has since moved off (a property whose context
  // went stale). Compare with, and write to, the property's newest row instead: otherwise every save
  // adds another draft, and setting the published value back looks unchanged and keeps the draft.
  const localIdRow = localIdParam ? rows.find((row) => row.localId === localIdParam) : undefined
  if (localIdRow?.uid && localIdRow.propertyName && localIdRow.seedLocalId) {
    const newestRows = (await appDb
      .select()
      .from(metadata)
      .where(
        and(
          eq(metadata.propertyName, localIdRow.propertyName),
          eq(metadata.seedLocalId, localIdRow.seedLocalId),
        ),
      )
      .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))
      .limit(1)) as (MetadataType & { localId?: string | null })[]
    if (newestRows.length > 0) rows = newestRows
  }

  if (rows && rows.length > 0) {
    const {
      localId,
      uid,
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
        updatedAt: now,
      }
      if (localStorageDir !== undefined) {
        updatePayload.localStorageDir = localStorageDir ?? null
      }
      await appDb
        .update(metadata)
        .set(updatePayload as Partial<typeof metadata.$inferInsert>)
        .where(eq(metadata.localId, localId))

      return { localId, uid: null, schemaUid: schemaUid ?? '' }
    }

    const seedDataFromDb = seedLocalId ? await getSeedData({ seedLocalId }) : null
    const versionDataFromDb = versionLocalId ? await getVersionData({ localId: versionLocalId }) : null

    // Here we don't have a local-only record so we need to create a new one
    const newLocalId = generateId()
    // The row belongs to its seed's wallet, like createMetadata's.
    const publisher = await getSeedPublisher(seedLocalIdFromDb ?? seedLocalId)

    await appDb.insert(metadata).values({
      localId: newLocalId,
      ...(publisher && { publisher }),
      propertyName: propertyNameFromDb,
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
      createdAt: Date.now(),
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
    const seedData = await getSeedData({ seedLocalId: seedLocalId || undefined })
    if (seedData) {
      seedUid = seedData.uid || undefined
    }
  }

  if (!versionUid) {
    const versionData = await getVersionData({ localId: versionLocalId })
    if (versionData) {
      versionUid = versionData.uid
    }
  }

  const publisher = await getSeedPublisher(seedLocalId)

  await appDb.insert(metadata).values({
    localId: newLocalId,
    ...(publisher && { publisher }),
    propertyName,
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
    createdAt: Date.now(),
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
