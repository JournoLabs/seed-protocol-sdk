import { inArray } from 'drizzle-orm'
import type { BaseDb } from '@/db/Db/BaseDb'
import { metadata, modelUids, properties, propertyUids } from '@/seedSchema'

type AppDb = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/**
 * Before deleting property rows: unlink stored item values (metadata.property_id → NULL; the
 * values stay, keyed by property name) and drop the properties' EAS uid mappings. Without this,
 * Node (libsql enforces foreign keys) fails the delete as soon as an item has a value, and the
 * browser leaves rows pointing at deleted ids.
 */
export async function detachPropertyRows(db: AppDb, propertyIds: readonly number[]): Promise<void> {
  if (propertyIds.length === 0) return
  const ids = [...propertyIds]
  await db.update(metadata).set({ propertyId: null }).where(inArray(metadata.propertyId, ids))
  await db.delete(propertyUids).where(inArray(propertyUids.propertyId, ids))
}

/**
 * Before deleting model rows: detach their properties' rows (as above), drop the models' EAS
 * uid mappings, and clear relation properties elsewhere that point at them (ref_model_id).
 */
export async function detachModelRows(db: AppDb, modelIds: readonly number[]): Promise<void> {
  if (modelIds.length === 0) return
  const ids = [...modelIds]
  const propertyRows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(inArray(properties.modelId, ids))
  await detachPropertyRows(
    db,
    propertyRows.map((row: { id: number | null }) => row.id).filter((id: number | null): id is number => id != null),
  )
  await db.delete(modelUids).where(inArray(modelUids.modelId, ids))
  await db.update(properties).set({ refModelId: null }).where(inArray(properties.refModelId, ids))
}
