import { beforeEach, describe, expect, it } from 'vitest'
import type { GraphQLClient } from 'graphql-request'
import { getEasSchemaUidBySchemaName } from '../src/api.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../src/QueryClient/BaseQueryClient.js'
import type { FetchQueryOptions, IQueryClient } from '../src/QueryClient/IQueryClient.js'

/** Mimics TanStack Query: results and in-flight promises are shared per serialized queryKey. */
const createCachingQueryClient = (): IQueryClient => {
  const cache = new Map<string, Promise<unknown>>()
  return {
    fetchQuery: <T>({ queryKey, queryFn }: FetchQueryOptions<T>) => {
      const hash = JSON.stringify(queryKey)
      if (!cache.has(hash)) cache.set(hash, queryFn())
      return cache.get(hash) as Promise<T>
    },
    getQueryData: (queryKey) => cache.get(JSON.stringify(queryKey)),
    removeQueries: async ({ queryKey }) => {
      cache.delete(JSON.stringify(queryKey))
    },
  }
}

const SCHEMA_UIDS: Record<string, string> = {
  'string title': '0x' + 'a'.repeat(64),
  'bytes32 image': '0x' + 'b'.repeat(64),
}

const fakeEasClient = {
  request: async (_doc: unknown, variables: { where: { schema: { endsWith: string } } }) => {
    // Yield so concurrent lookups overlap while in flight.
    await new Promise((r) => setTimeout(r, 5))
    const suffix = variables.where.schema.endsWith
    const id = Object.entries(SCHEMA_UIDS).find(([def]) => def.endsWith(suffix))?.[1]
    return { schemas: id ? [{ id }] : [] }
  },
} as unknown as GraphQLClient

describe('getEasSchemaUidBySchemaName', () => {
  beforeEach(() => {
    const queryClient = createCachingQueryClient()
    BaseQueryClient.configure({ getQueryClient: () => queryClient })
    BaseEasClient.configure({ getEasClient: () => fakeEasClient })
  })

  it('resolves different schema names to different UIDs when called concurrently', async () => {
    const [title, image] = await Promise.all([
      getEasSchemaUidBySchemaName({ schemaName: 'title' }),
      getEasSchemaUidBySchemaName({ schemaName: 'image' }),
    ])
    expect(title).toBe(SCHEMA_UIDS['string title'])
    expect(image).toBe(SCHEMA_UIDS['bytes32 image'])
  })

  it('does not return a cached UID for a different schema name', async () => {
    expect(await getEasSchemaUidBySchemaName({ schemaName: 'title' })).toBe(
      SCHEMA_UIDS['string title'],
    )
    expect(await getEasSchemaUidBySchemaName({ schemaName: 'image' })).toBe(
      SCHEMA_UIDS['bytes32 image'],
    )
  })
})
