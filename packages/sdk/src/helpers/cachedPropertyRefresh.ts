/**
 * Lets helpers/db tell cached ModelProperty and ItemProperty instances that their properties' rows
 * changed, without importing either class (helpers/db -> ModelProperty is a circular import, and a
 * dynamic import of it can hang during init). Each class registers its refresher when it loads;
 * until then nothing of it is cached, so there is nothing to refresh.
 */
type CachedPropertyRefresher = (propertyFileIds: string[]) => Promise<void>

const refreshers = new Set<CachedPropertyRefresher>()

export function addCachedPropertyRefresher(fn: CachedPropertyRefresher): void {
  refreshers.add(fn)
}

/** Give cached instances of these properties their rows' current definitions. */
export async function refreshCachedProperties(propertyFileIds: string[]): Promise<void> {
  if (propertyFileIds.length === 0) return
  for (const refresher of refreshers) await refresher(propertyFileIds)
}
