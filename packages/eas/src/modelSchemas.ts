import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { GET_SCHEMAS } from './queries.js'
import { timedFetchQuery } from './easTiming.js'
import type { Schema as EASSchema } from './graphql/gql/graphql.js'
import {
  compareNameMatchTiers,
  DEFAULT_NAME_MATCH_LEVEL,
  easName,
  easNamesToFetch,
  matchEasName,
  type NameMatchLevel,
  type NameMatchTier,
} from './easNames.js'

/** A local model name and the nameMatch level (ADR 0009) its EAS names match at. */
export type ModelSchemaLookup = {
  name: string
  level?: NameMatchLevel
}

/** An EAS model schema and the local model name it matched. */
export type EasModelSchemaMatch = {
  schema: EASSchema
  modelName: string
  tier: NameMatchTier
}

/** The definition of a model's seed schema on EAS: `bytes32 <easName>` (ADR 0008). */
export const modelSchemaDefinition = (modelName: string): string => `bytes32 ${easName(modelName)}`

const BYTES32_PREFIX = 'bytes32 '

/** One entry per name; a name given at two levels (two schemas defining it) takes the tighter. */
const levelsByName = (models: readonly ModelSchemaLookup[]): Map<string, NameMatchLevel> => {
  const byName = new Map<string, NameMatchLevel>()
  for (const { name, level } of models) {
    if (!name) continue
    const current = byName.get(name)
    const next = level ?? DEFAULT_NAME_MATCH_LEVEL
    if (!current || compareNameMatchTiers(next, current) < 0) byName.set(name, next)
  }
  return byName
}

/**
 * The EAS model schemas (`bytes32 <name>`) the given local model names can match, in one request:
 * every name each model can match at its level (`easNamesToFetch`; at `exact` only
 * `bytes32 <easName>`). A superset; {@link matchEasModelSchemas} says which model each is for.
 * Empty when the EAS clients aren't configured. Throws when the request fails.
 */
export const fetchEasModelSchemas = async (models: readonly ModelSchemaLookup[]): Promise<EASSchema[]> => {
  const byName = levelsByName(models)
  if (byName.size === 0) return []

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  if (!queryClient || !easClient) return []

  const definitions = new Set<string>()
  for (const [name, level] of byName) {
    for (const easSchemaName of easNamesToFetch(name, level)) definitions.add(`${BYTES32_PREFIX}${easSchemaName}`)
  }
  const sorted = [...definitions].sort()
  const result = (await timedFetchQuery(queryClient, {
    queryKey: ['fetchEasModelSchemas', sorted],
    queryFn: async () => easClient.request(GET_SCHEMAS, { where: { schema: { in: sorted } } }),
  })) as { schemas?: EASSchema[] } | undefined
  return result?.schemas ?? []
}

/**
 * The local model each EAS model schema stands for, by `matchEasName` at each model's level: the
 * tightest tier wins, a tie matches nothing, and unmatched schemas are left out. Same-named models
 * are one candidate, since they share one EAS schema. A match at tier `exact` is the schema publish
 * writes the model's seeds under; looser matches are schemas older SDKs published under, for
 * reading their seeds.
 */
export const matchEasModelSchemas = (
  schemas: readonly EASSchema[],
  models: readonly ModelSchemaLookup[],
): EasModelSchemaMatch[] => {
  const candidates = [...levelsByName(models)].map(([name, level]) => ({ value: name, name, level }))
  const matches: EasModelSchemaMatch[] = []
  for (const schema of schemas) {
    if (!schema.schema?.startsWith(BYTES32_PREFIX)) continue
    const match = matchEasName(schema.schema.slice(BYTES32_PREFIX.length), candidates)
    if (match.kind === 'match') matches.push({ schema, modelName: match.value, tier: match.tier })
  }
  return matches
}

/** {@link fetchEasModelSchemas} then {@link matchEasModelSchemas}. Throws when the request fails. */
export const getEasModelSchemasForNames = async (
  models: readonly ModelSchemaLookup[],
): Promise<EasModelSchemaMatch[]> => matchEasModelSchemas(await fetchEasModelSchemas(models), models)
