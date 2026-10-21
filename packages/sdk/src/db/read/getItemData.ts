import { GetItemData, ItemData } from "@/types"
import debug from "debug"
import { BaseDb } from "../Db/BaseDb"
import { eq } from "drizzle-orm"
import { easName } from '@seedprotocol/eas'
import { getItemProperties } from "./getItemProperties"
import { versions } from "@/seedSchema"
import { findSeedRow } from "./findSeedRow"
import { getModelSchemaName, resolveModelRecordByNameOrType } from "./resolveModelRecord"
import { getLatestPublishedVersionRow } from "./getLatestPublishedVersionRow"
import { isVersionRevoked } from "./subqueries/liveVersion"
import { latestVersionOrder } from "./subqueries/latestVersion"
import { metadataRowPropertyKey } from "@/helpers/metadataPropertyNames"
import { metadataPropertyNameForms, readMetadataPropertiesById } from "@/db/read/metadataProperty"

const logger = debug('seedSdk:db:read:getItemData')

/**
 * Assemble flat ItemData for Item / liveQuery / draft-head authoring.
 *
 * For **published chain JSON** (Seed → latest attested Version → properties),
 * prefer `getPublishedSeedRecord` from `@seedprotocol/sdk` or
 * `getSeed` / `queryBySchema` from `@seedprotocol/query`. This function remains
 * the correct path for local-head / draft-wins property selection used by Item.
 */
export const getItemData: GetItemData = async ({
  modelName,
  seedLocalId,
  seedUid,
}) => {
  if (!seedLocalId && !seedUid) {
    throw new Error('[db/queries] [getItem] no seedLocalId or seedUid')
  }

  const appDb = BaseDb.getAppDb()

  const seed = await findSeedRow({ localId: seedLocalId, uid: seedUid }, appDb)
  logger('[getItemData] Seed lookup result', { found: !!seed })
  if (!seed || (modelName && seed.type !== easName(modelName))) {
    logger('[db/queries] [getItemDataFromDb] no seedRows found', { modelName, seedLocalId, seedUid })
    return
  }
  seedLocalId = seed.localId
  const { localId: _localId, uid: _uid, ...rest } = seed
  const seedRow = { ...rest, seedLocalId: seed.localId, seedUid: seed.uid }
  const resolvedSeedLocalId = seedRow.seedLocalId

  // The seed's model (its model_file_id, else the model its type names at nameMatch level) and that
  // model's schema, for multi-schema Model resolution. Several schemas defining the type's model
  // leave both unset; Item.create then raises AmbiguousModelError.
  let schemaName: string | undefined
  let resolvedModelName: string | undefined
  try {
    const model = await resolveModelRecordByNameOrType(modelName ?? seedRow.type, { modelFileId: seedRow.modelFileId }, appDb)
    if (model) {
      resolvedModelName = model.name
      schemaName = await getModelSchemaName(model.id, appDb)
    }
  } catch (error) {
    logger('[getItemData] Error resolving the model:', error)
  }

  // Now get version data if it exists - query versions table directly
  let versionRow: {
    versionsCount: number
    lastVersionPublishedAt: number | null
    latestVersionUid: string | null
    latestVersionLocalId: string | null
    publishedVersionUid: string | null
    publishedVersionLocalId: string | null
    lastLocalUpdateAt?: number | null
  } = {
    versionsCount: 0,
    lastVersionPublishedAt: null,
    latestVersionUid: null,
    latestVersionLocalId: null,
    publishedVersionUid: null,
    publishedVersionLocalId: null,
    lastLocalUpdateAt: null,
  }
  
  try {
    const allVersions = await appDb
      .select({
        localId: versions.localId,
        uid: versions.uid,
        createdAt: versions.createdAt,
        attestationCreatedAt: versions.attestationCreatedAt,
        revokedAt: versions.revokedAt,
      })
      .from(versions)
      .where(eq(versions.seedLocalId, resolvedSeedLocalId))
      .orderBy(latestVersionOrder())

    if (allVersions.length > 0) {
      // Revoked versions are never the latest one and don't count as published (same as the
      // getVersionData subquery); versionsCount / lastLocalUpdateAt still cover every row.
      const liveVersions = allVersions.filter(
        (v: { revokedAt: number | null }) => !isVersionRevoked(v.revokedAt),
      )
      const latest = liveVersions[0]
      let lastPub: number | null = null
      for (const v of liveVersions) {
        const t = v.attestationCreatedAt
        if (t != null && (lastPub == null || t > lastPub)) lastPub = t
      }
      let lastLocal = 0
      for (const v of allVersions) {
        const t = v.createdAt ?? 0
        if (t > lastLocal) lastLocal = t
      }
      const published = await getLatestPublishedVersionRow(resolvedSeedLocalId)
      versionRow = {
        versionsCount: allVersions.length,
        lastVersionPublishedAt: lastPub,
        latestVersionUid: latest?.uid ?? null,
        latestVersionLocalId: latest?.localId ?? null,
        publishedVersionUid: published?.uid ?? null,
        publishedVersionLocalId: published?.localId ?? null,
        lastLocalUpdateAt: lastLocal || null,
      }
    }
  } catch (error) {
    console.error('[getItemData] Error querying versions', error)
    // Continue with default versionRow values
  }

  const itemData = {
    ...seedRow,
    ...versionRow,
    ...(resolvedModelName && !modelName && { modelName: resolvedModelName }),
    schemaName,
  } as ItemData & { [key: string]: any }

  const propertiesData = await getItemProperties({
    seedLocalId,
    seedUid: itemData.seedUid || undefined,
  })

  if (!propertiesData || propertiesData.length === 0) {
    return itemData
  }

  // Rows linked by property_id are their property's (decision D4): read under its key, and under
  // the stored name only when that is one of the key's stored forms (`textId`, `authorIdentityIds`).
  // A renamed property's rows keep the old name, which is no longer the property's.
  const propertiesById = await readMetadataPropertiesById(
    appDb,
    propertiesData.map((data) => (data as { propertyId?: number | null }).propertyId),
  )
  for (const propertyData of propertiesData) {
    const propertyName = propertyData.propertyName
    const propertyValue = propertyData.propertyValue
    const propertyId = (propertyData as { propertyId?: number | null }).propertyId
    const property = propertyId != null ? propertiesById.get(propertyId) : undefined
    if (property) {
      itemData[property.name] = propertyValue
      if (metadataPropertyNameForms(property).includes(propertyName)) itemData[propertyName] = propertyValue
      continue
    }

    // No property_id: the stored name, and for a ref row its `<key>Id` stripped
    const key = metadataRowPropertyKey(propertyData)
    if (key && key !== propertyName && propertyData.refSeedType) {
      itemData[key] = propertyValue
    }
    itemData[propertyName] = propertyValue
  }

  if (itemData) return itemData
}