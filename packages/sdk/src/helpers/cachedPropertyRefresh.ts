/**
 * Lets helpers/db tell cached ModelProperty instances that their rows changed, without importing
 * ModelProperty (helpers/db -> ModelProperty is a circular import, and a dynamic import of it can hang
 * during init). ModelProperty registers its refresher when it loads; until then nothing is cached,
 * so there is nothing to refresh.
 */
type CachedPropertyRefresher = (propertyFileIds: string[]) => Promise<void>

let refresher: CachedPropertyRefresher | undefined

export function setCachedPropertyRefresher(fn: CachedPropertyRefresher): void {
  refresher = fn
}

/** Give cached ModelProperty instances of these properties their rows' current values. */
export async function refreshCachedProperties(propertyFileIds: string[]): Promise<void> {
  if (!refresher || propertyFileIds.length === 0) return
  await refresher(propertyFileIds)
}
