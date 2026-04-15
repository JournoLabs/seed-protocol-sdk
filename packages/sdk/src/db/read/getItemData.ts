import { GetItemData, ItemData } from "@/types"
import debug from "debug"
import { BaseDb } from "../Db/BaseDb"
import { and, eq, getTableColumns, SQL } from "drizzle-orm"
import { toSnakeCase } from "drizzle-orm/casing"
import { startCase } from "lodash-es"
import { getItemProperties } from "./getItemProperties"
import { seeds, versions } from "@/seedSchema"
import { models } from "@/seedSchema/ModelSchema"
import { modelSchemas } from "@/seedSchema/ModelSchemaSchema"
import { schemas as schemasTable } from "@/seedSchema/SchemaSchema"
import { getSeedData } from "./getSeedData"
import { getLatestPublishedVersionRow } from "./getLatestPublishedVersionRow"
import { toSchemaPropertyName } from "@/helpers/metadataPropertyNames"

const logger = debug('seedSdk:db:read:getItemData')

export const getItemData: GetItemData = async ({
  modelName,
  seedLocalId,
  seedUid,
}) => {
  if (!seedLocalId && !seedUid) {
    throw new Error('[db/queries] [getItem] no seedLocalId or seedUid')
  }

  if (seedUid && !seedLocalId) {
    const seedData = await getSeedData({ seedUid })
    if (!seedData) {
      logger('[db/queries] [getItem] no seedData seedUid', seedUid)
      return
    }
    seedLocalId = seedData.localId || undefined
  }

  const appDb = BaseDb.getAppDb()

  const { localId, uid, ...rest } = getTableColumns(seeds)

  const whereClauses: SQL[] = []

  if (modelName) {
    whereClauses.push(eq(seeds.type, toSnakeCase(modelName)))
  }

  if (seedUid) {
    whereClauses.push(eq(seeds.uid, seedUid))
  }

  if (seedLocalId && !seedUid) {
    whereClauses.push(eq(seeds.localId, seedLocalId))
  }

  // First, query the seeds table directly to find the item
  const seedRows = await appDb
    .select({
      ...rest,
      seedLocalId: seeds.localId,
      seedUid: seeds.uid,
    })
    .from(seeds)
    .where(and(...whereClauses))
    .limit(1)

  logger('[getItemData] Seed query result', { rowsCount: seedRows?.length || 0, firstRow: seedRows?.[0] })

  if (!seedRows || seedRows.length === 0) {
    logger('[db/queries] [getItemDataFromDb] no seedRows found', { modelName, seedLocalId, seedUid })
    return
  }

  const seedRow = seedRows[0]
  const resolvedSeedLocalId = seedRow.seedLocalId

  // Fix 5: Derive schemaName for multi-schema Model resolution (models -> model_schemas -> schemas)
  let schemaName: string | undefined
  const normalizedModelName = modelName ? startCase(modelName) : (seedRow.type ? startCase(seedRow.type) : undefined)
  if (appDb && normalizedModelName) {
    try {
      const schemaRows = await appDb
        .select({ schemaName: schemasTable.name })
        .from(models)
        .innerJoin(modelSchemas, eq(models.id, modelSchemas.modelId))
        .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
        .where(eq(models.name, normalizedModelName))
        .limit(1)
      if (schemaRows.length > 0 && schemaRows[0].schemaName) {
        schemaName = schemaRows[0].schemaName
      }
    } catch (error) {
      logger('[getItemData] Error deriving schemaName:', error)
    }
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
      })
      .from(versions)
      .where(eq(versions.seedLocalId, resolvedSeedLocalId))

    if (allVersions.length > 0) {
      const sorted = [...allVersions].sort((a, b) => {
        const ca = a.createdAt ?? 0
        const cb = b.createdAt ?? 0
        if (cb !== ca) return cb - ca
        return String(b.localId ?? '').localeCompare(String(a.localId ?? ''))
      })
      const latest = sorted[0]!
      let lastPub: number | null = null
      for (const v of allVersions) {
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
        latestVersionUid: latest.uid ?? null,
        latestVersionLocalId: latest.localId ?? null,
        publishedVersionUid: published?.uid ?? null,
        publishedVersionLocalId: published?.localId ?? null,
        lastLocalUpdateAt: lastLocal || null,
      }
    }
  } catch (error) {
    console.error('[getItemData] Error querying versions', error)
    // Continue with default versionRow values
  }

  let itemData = {
    ...seedRow,
    ...versionRow,
    schemaName,
  } as ItemData & { [key: string]: any }

  const propertiesData = await getItemProperties({
    seedLocalId,
    seedUid: itemData.seedUid || undefined,
  })

  if (!propertiesData || propertiesData.length === 0) {
    return itemData
  }

  for (const propertyData of propertiesData) {
    const propertyName = propertyData.propertyName

    let propertyValue = propertyData.propertyValue

    const schemaBaseName = toSchemaPropertyName(propertyName)
    if (schemaBaseName && propertyData.refSeedType) {
      itemData[schemaBaseName] = propertyValue
    }

    itemData[propertyName] = propertyValue
  }

  if (itemData) return itemData
}