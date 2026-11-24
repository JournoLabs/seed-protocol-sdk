import { beforeEach, describe, expect, it } from 'vitest'
import type { GraphQLClient } from 'graphql-request'
import { getAttestationChangesSince } from '../src/api.js'
import { ARCHIVE_ANCHOR_SCHEMA_UID, LICENSE_OFFER_SCHEMA_UID } from '../src/constants.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../src/QueryClient/BaseQueryClient.js'

let wheres: any[] = []
let respond: (where: any) => unknown[] = () => []

const fakeEasClient = {
  request: async (_doc: unknown, variables: any) => {
    wheres.push(variables.where)
    return { changes: respond(variables.where) }
  },
} as unknown as GraphQLClient

const uid = (n: number) => '0x' + n.toString(16).padStart(64, '0')

describe('getAttestationChangesSince', () => {
  beforeEach(() => {
    wheres = []
    respond = () => []
    BaseQueryClient.configure({
      getQueryClient: () => ({
        fetchQuery: ({ queryFn }) => queryFn(),
        getQueryData: () => undefined,
        removeQueries: async () => {},
      }),
    })
    BaseEasClient.configure({ getEasClient: () => fakeEasClient })
  })

  it('filters by refUID or id, created or revoked after since', async () => {
    await getAttestationChangesSince({ refUIDs: [uid(1)], ids: [uid(2)], since: 500 })
    const changedSince = { OR: [{ timeCreated: { gt: 500 } }, { revocationTime: { gt: 500 } }] }
    const notAnchor = { schemaId: { notIn: [ARCHIVE_ANCHOR_SCHEMA_UID, LICENSE_OFFER_SCHEMA_UID] } }
    expect(wheres).toEqual([
      { AND: [{ refUID: { in: [uid(1)] } }, changedSince, notAnchor] },
      { AND: [{ id: { in: [uid(2)] } }, changedSince, notAnchor] },
    ])
  })

  it('splits long uid lists over several requests and merges the results by id', async () => {
    const refUIDs = Array.from({ length: 900 }, (_, i) => uid(i))
    respond = () => [{ id: uid(1), refUID: uid(0), timeCreated: 600, revocationTime: 0 }]

    const changes = await getAttestationChangesSince({ refUIDs, ids: [], since: 500 })
    expect(wheres.map((w) => w.AND[0].refUID.in.length)).toEqual([400, 400, 100])
    expect(changes).toHaveLength(1)
  })

  it('finds pair halves by attester or recipient, and returns addresses lowercase', async () => {
    const owner = '0x' + 'ab'.repeat(20)
    respond = () => [
      { id: uid(5), refUID: uid(0), timeCreated: 600, revocationTime: 0, schemaId: uid(9), attester: owner.toUpperCase().replace('0X', '0x'), recipient: owner },
    ]
    const changes = await getAttestationChangesSince({
      refUIDs: [],
      ids: [],
      halves: { schemaIds: [uid(9)], addresses: [owner] },
      since: 500,
    })
    const filter = wheres[0].AND[0]
    expect(filter.schemaId).toEqual({ in: [uid(9)] })
    expect(filter.OR.map((o: any) => Object.keys(o)[0])).toEqual(['attester', 'recipient'])
    expect(filter.OR[0].attester.in[0].toLowerCase()).toBe(owner)
    expect(changes[0]!.attester).toBe(owner)
  })

  it('makes no request when there is nothing to check', async () => {
    expect(await getAttestationChangesSince({ refUIDs: [], ids: [], since: 0 })).toEqual([])
    expect(wheres).toHaveLength(0)
  })
})
