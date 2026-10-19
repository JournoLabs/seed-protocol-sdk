import { fetchEasSchemaUidBySchemaName } from '../api.js'
import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { getEasEndpoint } from '../easEndpoint.js'
import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import { GET_SCHEMA_BY_NAME } from '../queries.js'
import { toSnakeCase } from '../utils.js'
import { easName } from '../easNames.js'

const schemaUidForSchemaDefinition = new Map<string, string>()
const schemaUidForModel = new Map<string, string>()

/**
 * How long a schema lookup that found nothing is remembered. Item creation looks up the same
 * property and model schemas for every item, and most local models have none on EAS, so misses are
 * cached too. After this, the next lookup asks EAS again, so a schema registered by another client
 * is eventually found. Registering a schema in this client forgets the misses it answers at once.
 */
export const SCHEMA_LOOKUP_MISS_TTL_MS = 5 * 60 * 1000

/** Found UIDs from exact-definition lookups (createMetadata / updateMetadata), by endpoint and definition. */
const schemaUidForExactDefinition = new Map<string, string>()
/** Lookup key → time its cached miss expires. */
const lookupMissExpiresAt = new Map<string, number>()
const lookupsInFlight = new Map<string, Promise<string | undefined>>()
/** Bumped when misses are cleared, so a lookup already in flight doesn't cache its stale miss. */
let missGeneration = 0

/** UIDs differ per chain, so lookups are scoped to the EAS endpoint they were made against. */
const currentEndpoint = (): string => {
  try {
    return getEasEndpoint()
  } catch {
    // Misconfigured chain: the lookup itself will fail and isn't cached.
    return ''
  }
}

const scopeToEndpoint = (key: string): string => `${currentEndpoint()}\n${key}`

/**
 * Runs an EAS schema lookup unless the same lookup found nothing within the last
 * SCHEMA_LOOKUP_MISS_TTL_MS. Concurrent lookups for one key share a request. Only misses are cached
 * here (callers keep their found UIDs); a lookup that throws is not cached.
 */
export const cachedSchemaLookup = async (
  key: string,
  lookup: () => Promise<string | undefined>,
): Promise<string | undefined> => {
  const scopedKey = scopeToEndpoint(key)
  const missExpiresAt = lookupMissExpiresAt.get(scopedKey)
  if (missExpiresAt !== undefined) {
    if (Date.now() < missExpiresAt) return undefined
    lookupMissExpiresAt.delete(scopedKey)
  }

  const inFlight = lookupsInFlight.get(scopedKey)
  if (inFlight) return inFlight

  const generation = missGeneration
  const request = lookup()
    .then((schemaUid) => {
      if (!schemaUid && generation === missGeneration) {
        lookupMissExpiresAt.set(scopedKey, Date.now() + SCHEMA_LOOKUP_MISS_TTL_MS)
      }
      return schemaUid
    })
    .finally(() => {
      if (lookupsInFlight.get(scopedKey) === request) lookupsInFlight.delete(scopedKey)
    })
  lookupsInFlight.set(scopedKey, request)
  return request
}

/** Forgets every cached miss, so the next lookups ask EAS again. */
export const clearSchemaLookupMisses = (): void => {
  missGeneration++
  lookupMissExpiresAt.clear()
  lookupsInFlight.clear()
}

/**
 * Forgets the cached misses (and lookups in flight) on the current endpoint whose key `answers`
 * matches. Called when a schema becomes known, with a test for the lookups it would now satisfy.
 * Forgetting every miss here instead made each save that read a stored model UID send all
 * property lookups to EAS again.
 */
const forgetMisses = (answers: (key: string) => boolean): void => {
  const prefix = `${currentEndpoint()}\n`
  const matches = (scopedKey: string) => scopedKey.startsWith(prefix) && answers(scopedKey.slice(prefix.length))
  let forgotInFlight = false
  for (const scopedKey of [...lookupMissExpiresAt.keys()]) {
    if (matches(scopedKey)) lookupMissExpiresAt.delete(scopedKey)
  }
  for (const scopedKey of [...lookupsInFlight.keys()]) {
    if (matches(scopedKey)) {
      lookupsInFlight.delete(scopedKey)
      forgotInFlight = true
    }
  }
  // A lookup in flight for a matching key would otherwise cache its stale miss when it settles.
  if (forgotInFlight) missGeneration++
}

/** Lookups a schema with this definition answers: by exact definition, or by a name it ends with. */
const definitionAnswers = (definition: string) => {
  const snake = toSnakeCase(definition)
  return (key: string) =>
    key === `definition:${definition}` ||
    (key.startsWith('schemaName:') && snake.endsWith(key.slice('schemaName:'.length)))
}

/** Clears every schema UID cache in this module (found UIDs and misses). For tests. */
export const resetSchemaUidCaches = (): void => {
  schemaUidForSchemaDefinition.clear()
  schemaUidForModel.clear()
  schemaUidForExactDefinition.clear()
  clearSchemaLookupMisses()
}

export const setSchemaUidForSchemaDefinition = ({
  text,
  schemaUid,
}: {
  text: string
  schemaUid: string
}): void => {
  schemaUidForSchemaDefinition.set(toSnakeCase(text), schemaUid)
  // A miss for this definition, or for a name it ends with, may now be found.
  forgetMisses(definitionAnswers(text))
}

export const setSchemaUidForModel = ({
  modelName,
  schemaUid,
}: {
  modelName: string
  schemaUid: string
}): void => {
  schemaUidForModel.set(modelName.toLowerCase(), schemaUid)
  // getEasSchemaUidForModel looks models up by EAS name.
  const modelKey = `model:${easName(modelName)}`
  forgetMisses((key) => key === modelKey)
}

export const getSchemaUidForModelFromCache = (modelName: string): string | undefined =>
  schemaUidForModel.get(modelName.toLowerCase())

/** UID cached for `text` by {@link setSchemaUidForSchemaDefinition} or an earlier lookup; no request. */
export const getSchemaUidForSchemaDefinitionFromCache = (text: string): string | undefined =>
  schemaUidForSchemaDefinition.get(toSnakeCase(text))

export const getEasSchemaUidForSchemaDefinition = async ({
  schemaText,
}: {
  schemaText: string
}): Promise<string | undefined> => {
  const textSnakeCase = toSnakeCase(schemaText)
  if (!schemaUidForSchemaDefinition.has(textSnakeCase)) {
    let schemaUid: string | undefined
    try {
      schemaUid = await cachedSchemaLookup(`schemaName:${textSnakeCase}`, () =>
        fetchEasSchemaUidBySchemaName({ schemaName: textSnakeCase }),
      )
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Failed to fetch schema for schema name ${textSnakeCase}:`, error)
      }
      return undefined
    }
    // Found on EAS, not newly registered: no cached misses to clear.
    if (schemaUid) schemaUidForSchemaDefinition.set(textSnakeCase, schemaUid)
    return schemaUid
  }
  return schemaUidForSchemaDefinition.get(textSnakeCase)
}

/**
 * UID of the EAS schema whose definition is exactly `schemaDefinition` (e.g. `string title`), or
 * undefined when EAS has none or the EAS clients aren't configured. Found UIDs and misses are
 * cached (see SCHEMA_LOOKUP_MISS_TTL_MS). Throws when the request fails.
 */
export const getEasSchemaUidForExactDefinition = async (
  schemaDefinition: string,
): Promise<string | undefined> => {
  const key = scopeToEndpoint(schemaDefinition)
  const cached = schemaUidForExactDefinition.get(key)
  if (cached) return cached

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  if (!queryClient || !easClient) return undefined

  const schemaUid = await cachedSchemaLookup(`definition:${schemaDefinition}`, async () => {
    const queryResult = await queryClient.fetchQuery({
      queryKey: ['getSchemaByDefinition', schemaDefinition],
      queryFn: async () =>
        easClient.request(GET_SCHEMA_BY_NAME, {
          where: { schema: { equals: schemaDefinition } },
        }),
    })
    // Handle both { schemas: [...] } and { data: { schemas: [...] } } formats
    const schemas =
      (queryResult as { schemas?: Array<{ id: string }> })?.schemas ??
      (queryResult as { data?: { schemas?: Array<{ id: string }> } })?.data?.schemas
    return Array.isArray(schemas) && schemas.length > 0 ? schemas[0]!.id : undefined
  })
  if (schemaUid) schemaUidForExactDefinition.set(key, schemaUid)
  return schemaUid
}
