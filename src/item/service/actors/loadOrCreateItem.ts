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
 * Create ItemProperty instances for all metadata records to ensure they're cached.
 * Passes propertyRecordSchema from Model when available (Fix 3: enables value persistence for runtime-created models).
 * @param metadataRows - Array of metadata records to create ItemProperty instances for
 * @param seedLocalId - Seed local ID
 * @param seedUid - Seed UID
 * @param modelName - Model name for resolving propertyRecordSchema from Model
 * @returns Map of propertyName -> ItemProperty instance
 */
const createItemPropertyInstances = async (
  metadataRows: any[],
  seedLocalId: string,
  seedUid: string | undefined,
  modelName: string
): Promise<Map<string, any>> => {
  const propertyInstances = new Map<string, any>()
  
  if (metadataRows.length === 0) {
    return propertyInstances
  }

  try {
    const itemPropertyMod = await import('../../../ItemProperty/ItemProperty')
    const { ItemProperty } = itemPropertyMod
    const { modelPropertiesToObject } = await import('../../../helpers/model')
    const { Model } = await import('../../../Model/Model')
    
    // Resolve Model and build property schemas for propertyRecordSchema (Fix 3)
    let propertySchemas: Record<string, any> = {}
    const model = Model.getByName(modelName)
    if (model?.properties?.length) {
      propertySchemas = modelPropertiesToObject(model.properties)
    }

    // Create instances for all metadata records in parallel with propertyRecordSchema
    const createPromises = metadataRows.map(async (metaRow) => {
      try {
        const propertyName = metaRow.propertyName
        if (!propertyName) {
          logger(`Metadata row missing propertyName, skipping`)
          return
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
        // Don't throw - continue with other properties
      }
    })
    
    await Promise.all(createPromises)
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

    // Step 4: Create ItemProperty instances from metadata records
    // This ensures they're in the cache when Item.properties getter is called
    const propertyInstances = metadataRecords.length > 0
      ? await createItemPropertyInstances(metadataRecords, resolvedSeedLocalId, resolvedSeedUid, modelName)
      : new Map<string, any>()

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
