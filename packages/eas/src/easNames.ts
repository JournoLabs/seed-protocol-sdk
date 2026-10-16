/**
 * Names on EAS (ADR 0008).
 *
 * Writing: {@link easName} is the only function that turns a local model or property name into an
 * EAS name (`HTMLPage` → `html_page`). Everything that registers, attests or looks up a schema by
 * name uses it.
 *
 * Reading: an EAS name is never turned back into a local name. It is matched against the local
 * candidates by key, at a {@link NameMatchLevel}:
 *
 * - `exact`: the EAS name is exactly `easName(local)`, what this SDK publishes.
 * - `normalized`: lowercase alphanumerics only. `html_page`, `htmlpage`, `HTMLPage` and
 *   `html-page` are the same; this finds seeds published under older SDKs' names.
 * - `fuzzy`: the normalized key without a trailing plural `s`, and for relations without a
 *   trailing `id`/`ids`. `posts` matches `post`, `author_id` matches the relation `author`.
 *   No edit distance: `title` never matches `tile`.
 *
 * The tightest tier wins; a tie in the best tier matches nothing.
 */

/**
 * The EAS name of a local model or property name: words split at lowercase-or-digit to uppercase
 * boundaries and before the last capital of an acronym, every other run of non-alphanumerics
 * turned into `_`, trimmed, lowercased.
 * `HTMLPage → html_page`, `ID3Tag → id3_tag`, `imageV2 → image_v2`, `New model → new_model`.
 */
export const easName = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()

export type NameMatchLevel = 'exact' | 'normalized' | 'fuzzy'

/** The levels, tightest first. */
export const NAME_MATCH_LEVELS: readonly NameMatchLevel[] = ['exact', 'normalized', 'fuzzy']

export const isNameMatchLevel = (value: unknown): value is NameMatchLevel =>
  typeof value === 'string' && (NAME_MATCH_LEVELS as readonly string[]).includes(value)

/** How closely two names matched: the tightest level that accepts them. */
export type NameMatchTier = NameMatchLevel

const TIER_RANK: Record<NameMatchTier, number> = { exact: 0, normalized: 1, fuzzy: 2 }

/** The default level (ADR 0008 and the nameMatch design): fuzzy. */
export const DEFAULT_NAME_MATCH_LEVEL: NameMatchLevel = 'fuzzy'

/** Lowercase alphanumerics only. */
export const normalizedNameKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The normalized key without a relation's trailing `ids`/`id` (when `relation`), then without a
 * trailing plural `s`. Short keys are left alone, so `ids` and `bus` stay themselves.
 */
export const fuzzyNameKey = (name: string, options: { relation?: boolean } = {}): string => {
  let key = normalizedNameKey(name)
  if (options.relation) {
    if (key.length > 3 && key.endsWith('ids')) key = key.slice(0, -3)
    else if (key.length > 2 && key.endsWith('id')) key = key.slice(0, -2)
  }
  if (key.length > 3 && key.endsWith('s') && !key.endsWith('ss')) key = key.slice(0, -1)
  return key
}

/**
 * The tightest tier at which a local name and a name from EAS match, or undefined. `relation`
 * says whether the local name is a relation (Relation, Image, File, Html, or a List of them).
 */
export function nameMatchTier(
  localName: string,
  name: string,
  options: { relation?: boolean } = {},
): NameMatchTier | undefined {
  if (easName(localName) === name) return 'exact'
  if (normalizedNameKey(localName) === normalizedNameKey(name)) return 'normalized'
  if (fuzzyNameKey(localName, options) === fuzzyNameKey(name, options)) return 'fuzzy'
  return undefined
}

export const isNameMatchAllowed = (tier: NameMatchTier, level: NameMatchLevel): boolean =>
  TIER_RANK[tier] <= TIER_RANK[level]

export const compareNameMatchTiers = (a: NameMatchTier, b: NameMatchTier): number =>
  TIER_RANK[a] - TIER_RANK[b]

export type NameMatchCandidate<T> = {
  value: T
  /** The local name as it is written to EAS (a list relation's storage name, for instance). */
  name: string
  relation?: boolean
  /** This candidate's level. Default {@link DEFAULT_NAME_MATCH_LEVEL}. */
  level?: NameMatchLevel
}

export type NameMatchResult<T> =
  | { kind: 'match'; value: T; tier: NameMatchTier }
  | { kind: 'ambiguous'; values: T[]; tier: NameMatchTier }
  | { kind: 'none' }

/**
 * The candidate an EAS name matches: the one in the tightest tier its own level allows. Several
 * candidates in that tier are ambiguous, and match nothing.
 */
export function matchEasName<T>(
  name: string,
  candidates: readonly NameMatchCandidate<T>[],
): NameMatchResult<T> {
  let best: NameMatchTier | undefined
  let values: T[] = []
  for (const candidate of candidates) {
    const tier = nameMatchTier(candidate.name, name, { relation: candidate.relation })
    if (!tier || !isNameMatchAllowed(tier, candidate.level ?? DEFAULT_NAME_MATCH_LEVEL)) continue
    if (best === undefined || compareNameMatchTiers(tier, best) < 0) {
      best = tier
      values = [candidate.value]
    } else if (tier === best) {
      values.push(candidate.value)
    }
  }
  if (best === undefined) return { kind: 'none' }
  if (values.length > 1) return { kind: 'ambiguous', values, tier: best }
  return { kind: 'match', value: values[0]!, tier: best }
}

/**
 * The local names an EAS name matches in the tightest tier that has any (each name at `level`, or
 * at the level `level(localName)` returns). Several names can share a tier, e.g. `New model` and
 * `NewModel` for `new_model`: the caller decides whether that's ambiguous (models in different
 * schemas) or the same thing.
 */
export function localNamesInBestMatchTier(
  name: string,
  localNames: Iterable<string>,
  options: { relation?: boolean; level?: NameMatchLevel | ((localName: string) => NameMatchLevel) } = {},
): Set<string> {
  const levelOf =
    typeof options.level === 'function'
      ? options.level
      : () => (options.level as NameMatchLevel | undefined) ?? DEFAULT_NAME_MATCH_LEVEL
  let best: NameMatchTier | undefined
  let names = new Set<string>()
  for (const localName of localNames) {
    const tier = nameMatchTier(localName, name, { relation: options.relation })
    if (!tier || !isNameMatchAllowed(tier, levelOf(localName))) continue
    if (best === undefined || compareNameMatchTiers(tier, best) < 0) {
      best = tier
      names = new Set([localName])
    } else if (tier === best) {
      names.add(localName)
    }
  }
  return names
}

/**
 * Names that can match `name` at the normalized level and that an SDK may have written: its EAS
 * name, and what older SDKs published (the simple snake_case: `HTMLPage` → `htmlpage`). For
 * fetching schemas by name; the results are then filtered with {@link matchEasName}.
 */
export function easNameVariants(name: string): string[] {
  const legacy = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  return [...new Set([easName(name), legacy, normalizedNameKey(name)])]
}

/**
 * The EAS names to fetch schemas under for a local model name at `level`: at `exact` its EAS name
 * only; at `normalized` also {@link easNameVariants} and the name as written; at `fuzzy` also a
 * plural or singular form of each. Fetching is a superset: results are still filtered with
 * {@link matchEasName}.
 */
export function easNamesToFetch(name: string, level: NameMatchLevel = DEFAULT_NAME_MATCH_LEVEL): string[] {
  if (level === 'exact') return [easName(name)]
  const names = new Set<string>([...easNameVariants(name), name])
  if (level === 'fuzzy') {
    for (const variant of [...names]) names.add(variant.endsWith('s') ? variant.slice(0, -1) : `${variant}s`)
  }
  return [...names]
}
