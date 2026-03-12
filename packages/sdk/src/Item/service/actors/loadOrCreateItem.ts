import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ItemMachineContext } from '@/types/item'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions, metadata } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'
import { getVersionData } from '@/db/read/subqueries/versionData'
import debug from 'debug'

const logger = debug('seedSdk:item:actors:loadOrCreateItem')

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
 * @returns Map of propertyName -> ItemProperty instance
 */
const createItemPropertyInstances = async (
  metadataRows: any[],
  seedLocalId: string,
  seedUid: string | undefined,
  modelName: string,
  versionLocalId?: string,
  versionUid?: string
): Promise<Map<string, any>> => {
  const propertyInstances = new Map<string, any>()

  try {
    const itemPropertyMod = await import('../../../ItemProperty/ItemProperty')
    const { ItemProperty } = itemPropertyMod
    const { modelPropertiesToObject } = await import('../../../helpers/model')
    const { Model } = await import('../../../Model/Model')

    // Resolve Model and build property schemas (use getByNameAsync for models not yet in cache)
    let propertySchemas: Record<string, any> = {}
    let model = Model.getByName(modelName)
    if (!model?.properties?.length) {
      model = await Model.getByNameAsync(modelName) ?? undefined
    }
    if (model?.properties?.length) {
      propertySchemas = modelPropertiesToObject(model.properties)
    }

    // Build map of metadata by propertyName for lookup
    const metadataByProperty = new Map<string, any>()
    for (const metaRow of metadataRows) {
      if (metaRow.propertyName) {
        metadataByProperty.set(metaRow.propertyName, metaRow)
      }
    }

    // Create instances for all metadata records
    for (const metaRow of metadataRows) {
      try {
        const propertyName = metaRow.propertyName
        if (!propertyName) {
          logger(`Metadata row missing propertyName, skipping`)
          continue
        }

        const createProps = {
          propertyName,
          seedLocalId,
          seedUid,
          modelName,
          propertyValue: metaRow.propertyValue ?? undefined,
          versionLocalId: metaRow.versionLocalId ?? undefined,
          versionUid: metaRow.versionUid ?? undefined,
          schemaUid: metaRow.schemaUid ?? undefined,
          propertyRecordSchema: propertySchemas[propertyName] ?? undefined,
        }

        const property = ItemProperty.create(createProps, { waitForReady: false })
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
          propertyValue: undefined,
          versionLocalId: versionLocalId ?? undefined,
          versionUid: versionUid ?? undefined,
          schemaUid: undefined,
          propertyRecordSchema: propSchema,
        }

        const property = ItemProperty.create(createProps, { waitForReady: false })
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

    // Step 1: Query seeds table FIRST by seedLocalId or seedUid
    const whereClauses = []
    if (seedUid) {
      whereClauses.push(eq(seeds.uid, seedUid))
    }
    if (seedLocalId && !seedUid) {
      whereClauses.push(eq(seeds.localId, seedLocalId))
    }

    const seedRecords = await db
      .select()
      .from(seeds)
      .where(and(...whereClauses))
      .limit(1)

    if (seedRecords.length === 0) {
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

    const seedRecord = seedRecords[0]
    const resolvedSeedLocalId = seedRecord.localId
    const resolvedSeedUid = seedRecord.uid || undefined
    const schemaUid = seedRecord.schemaUid || undefined

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
    const latestVersionLocalId = versionRecord.latestVersionLocalId
    const latestVersionUid = versionRecord.latestVersionUid || undefined

    if (!latestVersionLocalId) {
      logger(`No latest version found for seedLocalId: ${resolvedSeedLocalId}`)
      sendBack({
        type: 'loadOrCreateItemSuccess',
        item: {
          seedLocalId: resolvedSeedLocalId,
          seedUid: resolvedSeedUid,
          modelName,
          schemaUid,
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

    // Step 3: Query metadata table to find all metadata records that reference that version
    const metadataRecords = await db
      .select()
      .from(metadata)
      .where(
        and(
          eq(metadata.seedLocalId, resolvedSeedLocalId),
          eq(metadata.versionLocalId, latestVersionLocalId)
        )
      )

    logger(`Found ${metadataRecords.length} metadata records for version ${latestVersionLocalId}`)

    // Step 4: Create ItemProperty instances from metadata records + placeholders for model schema properties
    // Always call when we have a valid version so placeholders are created for properties without metadata
    const propertyInstances = await createItemPropertyInstances(
      metadataRecords,
      resolvedSeedLocalId,
      resolvedSeedUid,
      modelName,
      latestVersionLocalId,
      latestVersionUid
    )

    // Step 5: Return loaded item data with property instances
    sendBack({
      type: 'loadOrCreateItemSuccess',
      item: {
        seedLocalId: resolvedSeedLocalId,
        seedUid: resolvedSeedUid,
        modelName,
        schemaUid,
        latestVersionLocalId,
        latestVersionUid,
        versionsCount: versionRecord.versionsCount || 0,
        lastVersionPublishedAt: versionRecord.lastVersionPublishedAt || undefined,
        attestationCreatedAt: seedRecord.attestationCreatedAt || undefined,
        createdAt: seedRecord.createdAt || Date.now(),
        publisher: seedRecord.publisher ?? undefined,
        revokedAt: seedRecord.revokedAt ?? undefined,
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
