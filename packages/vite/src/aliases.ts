import type { UserConfig } from 'vite'

export type AliasEntry = { find: string | RegExp; replacement: string }

export function normalizeAliasEntries(
  alias: NonNullable<UserConfig['resolve']>['alias'] | undefined,
): AliasEntry[] {
  if (!alias) return []
  if (Array.isArray(alias)) {
    return alias
      .filter((entry): entry is AliasEntry => !!entry && !!(entry as AliasEntry).replacement)
      .map((entry) => ({ find: entry.find, replacement: entry.replacement }))
  }
  return Object.entries(alias).map(([find, replacement]) => ({
    find,
    replacement: String(replacement),
  }))
}

/** `existing` plus the `additions` whose find it doesn't already have, after it. */
export function mergeAliasEntries(existing: AliasEntry[], additions: AliasEntry[]): AliasEntry[] {
  const merged = [...existing]
  const keyOf = (find: string | RegExp) =>
    typeof find === 'string' ? `s:${find}` : `r:${find.toString()}`
  const seen = new Set(merged.map((entry) => keyOf(entry.find)))
  for (const entry of additions) {
    const key = keyOf(entry.find)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return merged
}

/**
 * Append aliases to the user's config in place. Vite merges a returned alias list *before*
 * the existing one, so returning ours would let it shadow the user's; appending (Vite's
 * documented escape hatch when merging can't express the order) keeps user aliases first.
 */
export function appendAliases(userConfig: UserConfig, additions: AliasEntry[]): void {
  if (additions.length === 0) return
  userConfig.resolve = {
    ...userConfig.resolve,
    alias: mergeAliasEntries(normalizeAliasEntries(userConfig.resolve?.alias), additions),
  }
}
