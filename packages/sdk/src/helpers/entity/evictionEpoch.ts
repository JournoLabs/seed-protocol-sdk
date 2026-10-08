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

export function currentEvictionEpoch(): number {
  return epoch
}

/** Called by Model.evictForSchema. */
export function recordSchemaEviction(schemaName: string): void {
  epoch += 1
  lastEvictionBySchema.set(schemaName, epoch)
}

/** True when the schema's instances were evicted after `since` (an epoch from currentEvictionEpoch). */
export function schemaEvictedSince(schemaName: string | null | undefined, since: number): boolean {
  if (epoch === since || !schemaName) return false
  return (lastEvictionBySchema.get(schemaName) ?? 0) > since
}

/** True when any schema was evicted after `since` (cheap check before looking up which schemas apply). */
export function anyEvictionSince(since: number): boolean {
  return epoch !== since
}
