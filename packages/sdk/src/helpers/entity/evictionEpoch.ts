/**
 * Eviction epochs: lets work that was started before a schema's Model/ModelProperty instances were
 * evicted (Schema.destroy, test cleanup) tell, when it finishes, that it must not put instances for
 * that schema back in the caches. Stopping the evicted actors can't cancel such work (a DB lookup
 * that ends in Model.create, a model's property creation), and finishing it after the eviction would
 * rebuild instances from rows that are about to be deleted, which then write themselves again.
 *
 * Capture `currentEvictionEpoch()` when the work starts; before creating or caching an instance, skip
 * it when `schemaEvictedSince(schemaName, epoch)`. Work started after an eviction is unaffected.
 */

let epoch = 0
const lastEvictionBySchema = new Map<string, number>()
// Schemas whose destroy() is still running (by name)
const destroyingSchemas = new Map<string, number>()
// Single models destroyed (Model.destroy), by modelFileId
const lastDestroyByModelId = new Map<string, number>()
// Models whose destroy() is still deleting their rows
const destroyingModelIds = new Map<string, number>()

export function currentEvictionEpoch(): number {
  return epoch
}

/** Called by Model.evictForSchema. */
export function recordSchemaEviction(schemaName: string): void {
  epoch += 1
  lastEvictionBySchema.set(schemaName, epoch)
}

/**
 * Called by Schema.destroy before it evicts the schema's models; `finishSchemaDestroy` once its rows
 * are gone. The schema's actor stays live until then, and work it starts meanwhile (its live query
 * reading a model row the drained write just landed) captures an epoch after the eviction, so the
 * epoch alone can't tell it to stay away.
 */
export function recordSchemaDestroy(schemaName: string): void {
  recordSchemaEviction(schemaName)
  destroyingSchemas.set(schemaName, (destroyingSchemas.get(schemaName) ?? 0) + 1)
}

export function finishSchemaDestroy(schemaName: string): void {
  const remaining = (destroyingSchemas.get(schemaName) ?? 1) - 1
  if (remaining > 0) destroyingSchemas.set(schemaName, remaining)
  else destroyingSchemas.delete(schemaName)
  // Work that read a row during the destroy and checks after it must still see the eviction
  recordSchemaEviction(schemaName)
}

/**
 * True when the schema is being destroyed, or its instances were evicted after `since` (an epoch
 * from currentEvictionEpoch).
 */
export function schemaEvictedSince(schemaName: string | null | undefined, since: number): boolean {
  if (!schemaName) return false
  if (destroyingSchemas.has(schemaName)) return true
  if (epoch === since) return false
  return (lastEvictionBySchema.get(schemaName) ?? 0) > since
}

/**
 * Called by Model.destroy before it clears the caches; `finishModelDestroy` once its rows are gone.
 * Until then a lookup by id still finds the row, so it must not re-cache the model either.
 */
export function recordModelDestroy(modelFileId: string): void {
  epoch += 1
  lastDestroyByModelId.set(modelFileId, epoch)
  destroyingModelIds.set(modelFileId, (destroyingModelIds.get(modelFileId) ?? 0) + 1)
}

export function finishModelDestroy(modelFileId: string): void {
  const remaining = (destroyingModelIds.get(modelFileId) ?? 1) - 1
  if (remaining > 0) destroyingModelIds.set(modelFileId, remaining)
  else destroyingModelIds.delete(modelFileId)
}

/**
 * True when the model is being destroyed, or was destroyed after `since` (an epoch from
 * currentEvictionEpoch): a lookup that read its row must not create or cache an instance.
 */
export function modelDestroyedSince(modelFileId: string | null | undefined, since: number): boolean {
  if (!modelFileId) return false
  if (destroyingModelIds.has(modelFileId)) return true
  if (epoch === since) return false
  return (lastDestroyByModelId.get(modelFileId) ?? 0) > since
}

/**
 * True when any schema was evicted after `since` or is being destroyed (cheap check before looking up
 * which schemas apply).
 */
export function anyEvictionSince(since: number): boolean {
  return epoch !== since || destroyingSchemas.size > 0
}
