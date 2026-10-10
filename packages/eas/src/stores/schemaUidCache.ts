import { fetchEasSchemaUidBySchemaName } from '../api.js'
import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { getEasEndpoint } from '../easEndpoint.js'
import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import { GET_SCHEMA_BY_NAME } from '../queries.js'
import { toSnakeCase } from '../utils.js'

const schemaUidForSchemaDefinition = new Map<string, string>()
const schemaUidForModel = new Map<string, string>()

/**
 * How long a schema lookup that found nothing is remembered. Item creation looks up the same
 * property and model schemas for every item, and most local models have none on EAS, so misses are
 * cached too. After this, the next lookup asks EAS again, so a schema registered by another client
 * is eventually found. Registering a schema in this client clears cached misses immediately.
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
const scopeToEndpoint = (key: string): string => {
  let endpoint = ''
  try {
    endpoint = getEasEndpoint()
  } catch {
    // Misconfigured chain: the lookup itself will fail and isn't cached.
  }
  return `${endpoint}\n${key}`
}

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

/** Forgets every cached miss, so the next lookups ask EAS again. Called when a schema is registered. */
export const clearSchemaLookupMisses = (): void => {
  missGeneration++
  lookupMissExpiresAt.clear()
  lookupsInFlight.clear()
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
  // A miss for this or a related lookup (e.g. by property name) may now be found.
  clearSchemaLookupMisses()
}

export const setSchemaUidForModel = ({
  modelName,
  schemaUid,
}: {
  modelName: string
  schemaUid: string
}): void => {
  schemaUidForModel.set(modelName.toLowerCase(), schemaUid)
  clearSchemaLookupMisses()
}

export const getSchemaUidForModelFromCache = (modelName: string): string | undefined =>
  schemaUidForModel.get(modelName.toLowerCase())

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
