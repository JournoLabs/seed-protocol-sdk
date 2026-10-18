import { beforeEach, describe, expect, it } from 'vitest'
import { print } from 'graphql'
import type { GraphQLClient } from 'graphql-request'
import {
  getSchemaNamesBySchemaUids,
  getSeedsBySchemaName,
  getSeedsByUidsFromEas,
  resetSchemaNamesCache,
} from '../src/api.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../src/QueryClient/BaseQueryClient.js'
import {
  GET_ALL_PROPERTIES_FOR_ALL_VERSIONS,
  GET_PROPERTIES,
  GET_SEEDS_LEAN,
  GET_VERSIONS,
} from '../src/queries.js'

const POST_SCHEMA = '0x' + 'a'.repeat(64)
const IMAGE_SCHEMA = '0x' + 'b'.repeat(64)
const UNNAMED_SCHEMA = '0x' + 'c'.repeat(64)

const NAMES: Record<string, string[]> = {
  [POST_SCHEMA]: ['post'],
  [IMAGE_SCHEMA]: ['image'],
}

const seed = (id: string, schemaId: string) => ({
  id,
  schemaId,
  decodedDataJson: '',
  refUID: '0x0',
  timeCreated: 1,
  revoked: false,
  revocationTime: 0,
})

let requests: Array<{ operation: string; variables: any }> = []
let seedsResponse: ReturnType<typeof seed>[] = []

const fakeEasClient = {
  request: async (doc: any, variables: any) => {
    const operation = doc.definitions[0].name.value as string
    requests.push({ operation, variables })
    if (operation === 'GetSchemas') {
      const ids: string[] = variables.where.id.in
      return {
        schemas: ids
          .filter((id) => id in NAMES)
          .map((id) => ({ id, schemaNames: NAMES[id]!.map((name) => ({ name })) })),
      }
    }
    return { itemSeeds: seedsResponse }
  },
} as unknown as GraphQLClient

describe('lean seed queries', () => {
  beforeEach(() => {
    requests = []
    seedsResponse = []
    resetSchemaNamesCache()
    BaseQueryClient.configure({
      getQueryClient: () => ({
        fetchQuery: ({ queryFn }) => queryFn(),
        getQueryData: () => undefined,
        removeQueries: async () => {},
      }),
    })
    BaseEasClient.configure({ getEasClient: () => fakeEasClient })
  })

  it('version and property queries do not select the schema join', () => {
    for (const doc of [GET_VERSIONS, GET_PROPERTIES, GET_ALL_PROPERTIES_FOR_ALL_VERSIONS, GET_SEEDS_LEAN]) {
      expect(print(doc)).not.toMatch(/schemaNames/)
    }
  })

  it('getSeedsByUidsFromEas attaches schema names from schemaId', async () => {
    seedsResponse = [seed('0x1', POST_SCHEMA), seed('0x2', IMAGE_SCHEMA), seed('0x3', UNNAMED_SCHEMA)]
    const seeds = await getSeedsByUidsFromEas({ uids: ['0x1', '0x2', '0x3'] })

    expect(seeds.map((s) => s.schema.schemaNames.map((n) => n.name))).toEqual([['post'], ['image'], []])
    expect(requests.map((r) => r.operation)).toEqual(['GetSeedsLean', 'GetSchemas'])
  })

  it('caches found schema names and asks again for unnamed schemas', async () => {
    await getSchemaNamesBySchemaUids([POST_SCHEMA, UNNAMED_SCHEMA])
    requests = []

    const names = await getSchemaNamesBySchemaUids([POST_SCHEMA, UNNAMED_SCHEMA])
    expect(names.get(POST_SCHEMA)).toEqual(['post'])
    expect(names.has(UNNAMED_SCHEMA)).toBe(false)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.variables.where.id.in).toEqual([UNNAMED_SCHEMA])
  })

  it('getSeedsBySchemaName attaches the requested schema name without a schema lookup', async () => {
    seedsResponse = [seed('0x1', POST_SCHEMA)]
    const seeds = await getSeedsBySchemaName('post', 10)

    expect(seeds[0]!.schema.schemaNames).toEqual([{ name: 'post' }])
    expect(requests.map((r) => r.operation)).toEqual(['GetSeedsLean'])
  })
})
