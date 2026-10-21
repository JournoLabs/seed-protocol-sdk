import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ItemMachineContext } from '@/types/item'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { findSeedRow } from '@/db/read/findSeedRow'
import { getVersionData } from '@/db/read/subqueries/versionData'
import { getMetadataLatest } from '@/db/read/subqueries/metadataLatest'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { metadataRowPropertyKey } from '@/helpers/metadataPropertyNames'
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'
import { isDataType } from '@/helpers/property'
import debug from 'debug'
import { timingLogger, timingNow, timingSince } from '@/helpers/timing'

const logger = debug('seedSdk:item:actors:loadOrCreateItem')

function metadataValueStrength(row: any): number {
  const v = row?.propertyValue
  if (v == null || v === '') return 0
  return String(v).trim().length
}

/** A `<name>Id` row with no value and no file: a cleared Image, File, Html or Relation (ADR 0021). */
const isClearedIdRow = (row: any): boolean =>
  !!row?.propertyName?.endsWith('Id') && row.propertyValue === null && !row.refResolvedValue

/**
 * When storage + schema names map to the same key, prefer non-empty, then richer payload, then newer
 * row. A cleared Id row newer than the other wins: the other is the value it cleared, or older.
 */
function pickBetterMetadataRowForSameInstance(a: any, b: any): any {
  const newer = compareMetadataRowsLatestFirst(a, b) < 0 ? a : b
  if (isClearedIdRow(newer)) return newer
  const sa = metadataValueStrength(a)
  const sb = metadataValueStrength(b)
  if (sa > 0 && sb === 0) return a
  if (sb > 0 && sa === 0) return b
  if (sa !== sb) return sa > sb ? a : b
  const cmp = compareMetadataRowsLatestFirst(a, b)
  return cmp < 0 ? a : b
}

function dedupeMetadataRowsByInstanceKey(
  metadataRows: any[],
  propertySchemas: Record<string, any>,
): any[] {
  const byKey = new Map<string, any>()
  for (const metaRow of metadataRows) {
    const key = metadataRowPropertyKey(metaRow, propertySchemas)
    if (!key) continue
    const existing = byKey.get(key)
    byKey.set(key, existing ? pickBetterMetadataRowForSameInstance(existing, metaRow) : metaRow)
  }
  return Array.from(byKey.values())
}

/**
 * Create ItemProperty instances for all metadata records plus placeholder instances
 * for model schema properties that have no metadata. Ensures items (e.g. Image) have
 * all model properties (e.g. storageTransactionId) so getSegmentedItemProperties
 * can find them for getPublishPayload.
 * @param metadataRows - Array of metadata records to create ItemProperty instances for
 * @param seedLocalId - Seed local ID
 * @param seedUid - Seed UID
 * @param modelName - Model name for resolving propertyRecordSchema from Model
 * @param versionLocalId - Latest version local ID (for placeholder properties)
 * @param versionUid - Latest version UID (for placeholder properties)
 * @param modelScope - modelFileId / schemaName of the item's model (model names are only unique per schema)
 * @returns Map of propertyName -> ItemProperty instance
 */
const createItemPropertyInstances = async (
  metadataRows: any[],
  seedLocalId: string,
  seedUid: string | undefined,
  modelName: string,
  versionLocalId?: string,
  versionUid?: string,
  modelScope: { modelFileId?: string; schemaName?: string } = {},
): Promise<Map<string, any>> => {
  const propertyInstances = new Map<string, any>()

  try {
    const itemPropertyMod = await import('../../../ItemProperty/ItemProperty')
    const { ItemProperty } = itemPropertyMod
    // The model's property definitions from their rows; a model created in this session whose
    // rows aren't written yet gives its in-memory ones
    const { getModelPropertyDefinitions } = await import('../../../helpers/property')
    let propertySchemas: Record<string, any> = Object.fromEntries(
      await getModelPropertyDefinitions(modelName, modelScope).catch((err) => {
        logger(`No property definitions for ${modelName}: ${err}`)
        return []
      }),
    )
    if (Object.keys(propertySchemas).length === 0) {
      const { modelPropertiesToObject } = await import('../../../helpers/model')
      const { Model } = await import('../../../Model/Model')
      const model = Model.resolve(modelName, modelScope)
      if (model?.properties?.length) propertySchemas = modelPropertiesToObject(model.properties)
    }

    // Collapse rows that map to the same instance key (e.g. authorIdentityIds + authors -> authors).
    // ItemProperty.create cache does not sync propertyValue on hit; processing order would otherwise
    // let an empty "authors" row overwrite a populated storage row.
    const dedupedMetadataRows = dedupeMetadataRowsByInstanceKey(metadataRows, propertySchemas)

    // Create instances for all metadata records
    // For File/Image/Relation, metadata is stored with Id suffix (e.g. "textId") but schema defines base name ("text").
    // Normalize to schema name so we don't create duplicate properties (text + textId).
    for (const metaRow of dedupedMetadataRows) {
      try {
        // The property's key: through property_id (a renamed property's rows keep their stored
        // name), else from the stored name (`textId` → `text`, `authorIdentityIds` → `authors`)
        const propertyName = metadataRowPropertyKey(metaRow, propertySchemas)
        if (!propertyName) {
          logger(`Metadata row missing propertyName, skipping`)
          continue
        }

        const refSeedType = metaRow.refSeedType as string | undefined
        const isRefTypeFromMeta = refSeedType === 'file' || refSeedType === 'image' || refSeedType === 'relation' || refSeedType === 'html'

        // Infer propertyRecordSchema from metadata when schema is missing (enables persistence)
        let propSchema = propertySchemas[propertyName]
        if (!propSchema && isRefTypeFromMeta) {
          const schemaMod = await import('../../../Schema')
          const { ModelPropertyDataTypes } = schemaMod
          propSchema = {
            dataType: refSeedType === 'html' ? ModelPropertyDataTypes.Html
              : refSeedType === 'image' ? ModelPropertyDataTypes.Image
              : refSeedType === 'file' ? ModelPropertyDataTypes.File
              : refSeedType === 'relation' ? ModelPropertyDataTypes.Relation
              : ModelPropertyDataTypes.Text,
          }
        }
        const createProps = {
          propertyName,
          seedLocalId,
          seedUid,
          modelName,
          modelFileId: modelScope.modelFileId,
          propertyId: metaRow.propertyId ?? undefined,
          propertyValue: metaRow.propertyValue ?? undefined,
          versionLocalId: metaRow.versionLocalId ?? undefined,
          versionUid: metaRow.versionUid ?? undefined,
          schemaUid: metaRow.schemaUid ?? undefined,
          propertyRecordSchema: propSchema,
          refSeedType: metaRow.refSeedType ?? undefined,
          refResolvedValue: metaRow.refResolvedValue ?? undefined,
          // File/Image display values are session URLs the property mints from the file; a stored one is stale.
          refResolvedDisplayValue:
            refSeedType === 'file' || refSeedType === 'image' || isDataType(propSchema?.dataType, 'File') || isDataType(propSchema?.dataType, 'Image')
              ? undefined
              : metaRow.refResolvedDisplayValue ?? undefined,
          localStorageDir: metaRow.localStorageDir ?? undefined,
        }

        const property = ItemProperty.create(createProps, { waitForReady: false, hold: false })
        if (property) {
          propertyInstances.set(propertyName, property)
          logger(`Created/cached ItemProperty instance for propertyName "${propertyName}" with propertyRecordSchema: ${!!createProps.propertyRecordSchema}`)
        } else {
          logger(`ItemProperty.create returned undefined for propertyName "${propertyName}"`)
        }
      } catch (error) {
        logger(`Error creating ItemProperty instance for propertyName "${metaRow.propertyName}": ${error}`)
      }
    }

    // Create placeholder ItemProperty instances for model schema properties without metadata
    for (const [propertyName, propSchema] of Object.entries(propertySchemas)) {
      if (propertyInstances.has(propertyName)) continue

      try {
        const createProps = {
          propertyName,
          seedLocalId,
          seedUid,
          modelName,
          modelFileId: modelScope.modelFileId,
          propertyValue: undefined,
          versionLocalId: versionLocalId ?? undefined,
          versionUid: versionUid ?? undefined,
          schemaUid: undefined,
          propertyRecordSchema: propSchema,
        }

        const property = ItemProperty.create(createProps, { waitForReady: false, hold: false })
        if (property) {
          propertyInstances.set(propertyName, property)
          logger(`Created placeholder ItemProperty for model property "${propertyName}" (no metadata)`)
        }
      } catch (error) {
        logger(`Error creating placeholder ItemProperty for "${propertyName}": ${error}`)
      }
    }

    logger(`Finished creating/caching ${propertyInstances.size} ItemProperty instances`)
  } catch (error) {
    logger(`Error in createItemPropertyInstances: ${error}`)
    // Don't throw - this is best-effort to pre-populate cache
  }

  return propertyInstances
}

export const loadOrCreateItem = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateItem = async (): Promise<void> => {
    const { seedLocalId, seedUid, modelName } = context

    logger(`loadOrCreateItem called for modelName: ${modelName}, seedLocalId: ${seedLocalId}, seedUid: ${seedUid}`)

    if (!seedLocalId && !seedUid) {
      throw new Error('seedLocalId or seedUid is required')
    }

    if (!modelName) {
      throw new Error('modelName is required')
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not available')
    }

    // Step 1: the seed row (local id first, then the uid, following a republished seed's old uid)
    const timingStart = timingNow()
    const seedRecord = await findSeedRow({ localId: seedLocalId, uid: seedUid }, db)

    if (!seedRecord) {
      // Seed not found - this is a new item, will be created elsewhere
      logger(`Seed not found in database for seedLocalId: ${seedLocalId}, seedUid: ${seedUid}`)
      sendBack({
        type: 'loadOrCreateItemSuccess',
        item: {
          seedLocalId,
          seedUid,
          modelName,
          schemaUid: context.schemaUid,
          latestVersionLocalId: undefined,
          latestVersionUid: undefined,
          versionsCount: 0,
          lastVersionPublishedAt: undefined,
          attestationCreatedAt: undefined,
          createdAt: Date.now(),
          publisher: undefined,
          revokedAt: undefined,
        },
      })
      return
    }

    const resolvedSeedLocalId = seedRecord.localId
    const resolvedSeedUid = seedRecord.uid || undefined
    const schemaUid = seedRecord.schemaUid || undefined
    const modelFileId = seedRecord.modelFileId || context.modelFileId || undefined
    const modelScope = { modelFileId, schemaName: context.schemaName }

    const seedMs = timingSince(timingStart)
    // Step 2: Query versions table to find all versions for that seed
    const versionData = getVersionData()
    const versionRecords = await db
      .with(versionData)
      .select({
        seedLocalId: seeds.localId,
        seedUid: seeds.uid,
        latestVersionUid: versionData.latestVersionUid,
        latestVersionLocalId: versionData.latestVersionLocalId,
        versionsCount: versionData.versionsCount,
        lastVersionPublishedAt: versionData.lastVersionPublishedAt,
      })
      .from(seeds)
      .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
      .where(eq(seeds.localId, resolvedSeedLocalId))
      .limit(1)

    if (versionRecords.length === 0) {
      logger(`No version data found for seedLocalId: ${resolvedSeedLocalId}`)
      sendBack({
        type: 'loadOrCreateItemSuccess',
        item: {
          seedLocalId: resolvedSeedLocalId,
          seedUid: resolvedSeedUid,
          modelName,
          schemaUid,
          modelFileId,
          latestVersionLocalId: undefined,
          latestVersionUid: undefined,
          versionsCount: 0,
          lastVersionPublishedAt: undefined,
          attestationCreatedAt: seedRecord.attestationCreatedAt || undefined,
          createdAt: seedRecord.createdAt || Date.now(),
          publisher: seedRecord.publisher ?? undefined,
          revokedAt: seedRecord.revokedAt ?? undefined,
        },
      })
      return
    }

    const versionRecord = versionRecords[0]
    const latestVersionLocalId = versionRecord.latestVersionLocalId || undefined
    const latestVersionUid = versionRecord.latestVersionUid || undefined

    // A seed whose versions are all revoked (fully unpublished) has no latest version but still has
    // its last property values; load those like any other item. Only a seed without versions stops here.
    if (!latestVersionLocalId && !versionRecord.versionsCount) {
      logger(`No latest version found for seedLocalId: ${resolvedSeedLocalId}`)
      sendBack({
        type: 'loadOrCreateItemSuccess',
        item: {
          seedLocalId: resolvedSeedLocalId,
          seedUid: resolvedSeedUid,
          modelName,
          schemaUid,
          modelFileId,
          latestVersionLocalId: undefined,
          latestVersionUid: undefined,
          versionsCount: versionRecord.versionsCount || 0,
          lastVersionPublishedAt: versionRecord.lastVersionPublishedAt || undefined,
          attestationCreatedAt: seedRecord.attestationCreatedAt || undefined,
          createdAt: seedRecord.createdAt || Date.now(),
          publisher: seedRecord.publisher ?? undefined,
          revokedAt: seedRecord.revokedAt ?? undefined,
        },
      })
      return
    }

    // Step 3: Latest metadata row per property for this seed (matches loadOrCreateProperty /
    // getItemProperties). Strict version_local_id = latest would drop properties whose rows lag version bumps.
    const versionsMs = timingSince(timingStart) - seedMs
    const metadataLatest = getMetadataLatest({
      seedLocalId: resolvedSeedLocalId,
      seedUid: resolvedSeedUid,
    })
    const metadataRecords = await db
      .with(metadataLatest)
      .select()
      .from(metadataLatest)
      .where(eq(metadataLatest.rowNum, 1))

    logger(
      `Found ${metadataRecords.length} latest-per-property metadata rows for seed ${resolvedSeedLocalId} (latestVersionLocalId=${latestVersionLocalId} used for placeholders only)`,
    )

    const metadataMs = timingSince(timingStart) - seedMs - versionsMs
    // Step 4: Create ItemProperty instances from metadata records + placeholders for model schema properties
    // Always call when we have a valid version so placeholders are created for properties without metadata
    const propertyInstances = await createItemPropertyInstances(
      metadataRecords,
      resolvedSeedLocalId,
      resolvedSeedUid,
      modelName,
      latestVersionLocalId,
      latestVersionUid,
      modelScope,
    )

    // Step 4b: Wait for all property machines to reach idle so HTML/File content is loaded before Item is ready.
    // Without this, post.html returns seed ID on first render because loadOrCreateProperty hasn't finished.
    // Publish/attestation can keep properties in `saving` for many seconds; 5s caused timeouts during EAS work.
    const propertyIdleTimeoutMs = 120_000
    Promise.all(
      Array.from(propertyInstances.values()).map((prop) =>
        waitForEntityIdle(prop, { timeout: propertyIdleTimeoutMs, throwOnError: false })
      )
    ).catch(() => {})

    if (timingLogger.enabled) {
      const totalMs = timingSince(timingStart)
      timingLogger(
        `item ${resolvedSeedLocalId} loadOrCreateItem ${totalMs}ms: seed ${seedMs}, versions ${versionsMs}, metadata ${metadataMs}, ${propertyInstances.size} property instances ${totalMs - seedMs - versionsMs - metadataMs}`,
      )
    }

    // Step 5: Return loaded item data with property instances
    sendBack({
      type: 'loadOrCreateItemSuccess',
      item: {
        seedLocalId: resolvedSeedLocalId,
        seedUid: resolvedSeedUid,
        modelName,
        schemaUid,
        modelFileId,
        latestVersionLocalId,
        latestVersionUid,
        versionsCount: versionRecord.versionsCount || 0,
        lastVersionPublishedAt: versionRecord.lastVersionPublishedAt || undefined,
        attestationCreatedAt: seedRecord.attestationCreatedAt || undefined,
        createdAt: seedRecord.createdAt || Date.now(),
        publisher: seedRecord.publisher ?? undefined,
        revokedAt: seedRecord.revokedAt ?? undefined,
        // One id per property_name (latest row), not the full set of rows for latest version
        _metadataIds: metadataRecords.map((r: any) => r.localId || r.uid).filter(Boolean),
        propertyInstances,
      },
    })
  }

  _loadOrCreateItem().catch((error) => {
    logger(`Error in loadOrCreateItem: ${error}`)
    sendBack({
      type: 'loadOrCreateItemError',
      error: error instanceof Error ? error.message : String(error),
    })
  })
})
