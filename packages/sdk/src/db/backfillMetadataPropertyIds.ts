import { and, eq, isNull, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { getPropertyIdForModelAndName } from '@/helpers/db'
import debug from 'debug'

const logger = debug('seedSdk:db:backfillMetadataPropertyIds')

/**
 * Backfill metadata.property_id for rows that have model_type and property_name
 * but property_id is null. Run after migrations. Idempotent - only updates NULL rows.
 * Call after appDb is set (e.g. at end of prepareDb).
 */
export async function backfillMetadataPropertyIds(): Promise<number> {
  const db = BaseDb.getAppDb()
  if (!db) {
    logger('No app db available, skipping backfill')
    return 0
  }

  try {
    const rowsToBackfill = await db
      .select({
        localId: metadata.localId,
        modelType: metadata.modelType,
        propertyName: metadata.propertyName,
      })
      .from(metadata)
      .where(
        and(
          isNull(metadata.propertyId),
          sql`${metadata.modelType} IS NOT NULL`,
          sql`${metadata.propertyName} IS NOT NULL`,
        ),
      )

    if (rowsToBackfill.length === 0) {
      return 0
    }

    let updated = 0
    for (const row of rowsToBackfill) {
      if (!row.modelType || !row.propertyName || !row.localId) continue

      const propertyId = await getPropertyIdForModelAndName(
        row.modelType,
        row.propertyName,
      )
      if (propertyId == null) continue

      await db
        .update(metadata)
        .set({ propertyId })
        .where(eq(metadata.localId, row.localId))

      updated++
    }

    if (updated > 0) {
      logger(`Backfilled property_id for ${updated}/${rowsToBackfill.length} metadata rows`)
    }
    return updated
  } catch (error) {
    logger('Backfill error:', error)
    throw error
  }
}
