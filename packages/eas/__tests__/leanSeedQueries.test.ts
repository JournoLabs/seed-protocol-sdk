import { beforeEach, describe, expect, it } from 'vitest'
import { print } from 'graphql'
import type { GraphQLClient } from 'graphql-request'
import {
  getSchemaNamesBySchemaUids,
  getSeedsBySchemaName,
  getReportedAttestationUids,
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
import { seedSchemaUid } from '../src/seedSchemaUid.js'

const POST_SCHEMA = seedSchemaUid('bytes32 post')
const IMAGE_SCHEMA = seedSchemaUid('bytes32 image')
/** Not on EAS. */
const UNNAMED_SCHEMA = '0x' + 'c'.repeat(64)
/** `bytes32 post` registered by someone else with a resolver: another UID. */
const OTHER_POST_SCHEMA = '0x' + 'd'.repeat(64)
/** Not a model schema. */
const TITLE_SCHEMA = seedSchemaUid('string title')

/** Each schema's definition, and the names attested onto it (anyone can add one). */
const SCHEMAS: Record<string, { schema: string; names: string[] }> = {
  [POST_SCHEMA]: { schema: 'bytes32 post', names: ['image', 'post'] },
  [IMAGE_SCHEMA]: { schema: 'bytes32 image', names: [] },
  [OTHER_POST_SCHEMA]: { schema: 'bytes32 post', names: ['post'] },
  [TITLE_SCHEMA]: { schema: 'string title', names: ['post'] },
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
          .filter((id) => id in SCHEMAS)
          .map((id) => ({ id, schema: SCHEMAS[id]!.schema, schemaNames: SCHEMAS[id]!.names.map((name) => ({ name })) })),
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

  it('getSeedsByUidsFromEas attaches the model name from each schema definition', async () => {
    seedsResponse = [
      seed('0x1', POST_SCHEMA),
      seed('0x2', IMAGE_SCHEMA),
      seed('0x3', UNNAMED_SCHEMA),
      seed('0x4', OTHER_POST_SCHEMA),
      seed('0x5', TITLE_SCHEMA),
    ]
    const seeds = await getSeedsByUidsFromEas({ uids: ['0x1', '0x2', '0x3', '0x4', '0x5'] })

    // Not the names attested onto the schemas: POST_SCHEMA is also named "image", and the others
    // are named "post" without being Seed's post schema.
    expect(seeds.map((s) => s.schema.schemaNames.map((n) => n.name))).toEqual([['post'], ['image'], [], [], []])
    expect(requests.map((r) => r.operation)).toEqual(['GetSeedsLean', 'GetSchemas'])
  })

  // Batch 16 item 49: the indexer's uids are lower case
  it('getSeedsByUidsFromEas and getReportedAttestationUids ask with lower-case uids', async () => {
    const upper = '0x' + 'AB'.repeat(32)
    await getSeedsByUidsFromEas({ uids: [upper] })
    expect(JSON.stringify(requests[0]!.variables.where)).toContain(upper.toLowerCase())
    requests = []
    await getReportedAttestationUids([upper])
    expect(requests[0]!.variables.where.id.in).toEqual([upper.toLowerCase()])
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

  it("getSeedsBySchemaName filters by the model schema's UID, not by attested names", async () => {
    await getSeedsBySchemaName('BlogPost', 10)
    const { where } = requests[0]!.variables
    expect(where.schemaId).toEqual({ equals: seedSchemaUid('bytes32 blog_post') })
    expect(JSON.stringify(where)).not.toMatch(/schemaNames/)
  })

  it('getSeedsBySchemaName sends attesters checksummed, before take and skip', async () => {
    await getSeedsBySchemaName('post', 20, 40, {
      attesters: ['0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED', 'not-an-address', '5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'],
    })

    expect(requests).toHaveLength(1)
    const { where, take, skip } = requests[0]!.variables
    expect(where.attester).toEqual({ in: ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'] })
    expect([take, skip]).toEqual([20, 40])
  })

  it('getSeedsBySchemaName makes no request when no attester is an address', async () => {
    expect(await getSeedsBySchemaName('post', 10, 0, { attesters: ['', '0x1234'] })).toEqual([])
    expect(await getSeedsBySchemaName('post', 10, 0, { attesters: [] })).toEqual([])
    expect(requests).toEqual([])
  })
})
