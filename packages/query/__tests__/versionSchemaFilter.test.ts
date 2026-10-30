import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { ARCHIVE_ANCHOR_SCHEMA_UID, BaseEasClient, BaseQueryClient, VERSION_SCHEMA_UID } from '@seedprotocol/eas'
import { assembleSeeds } from '../src/assembleSeeds'
import { createRemoteQueryDataSource } from '../src/source/remote'
import type { AttestationLike } from '../src/types'

/**
 * A seed's newest attestation by refUID is a non-version attestation from the seed's own attester
 * (a PublishedBy sidecar, say). The remote source must not take it as the head version, or the
 * record assembles with no properties.
 */
const OWNER = '0x' + '1'.repeat(40)
const POST = '0x' + 'a'.repeat(64)
const POST_V = '0x' + 'b'.repeat(64)
const SIDECAR = '0x' + 'c'.repeat(64)

const att = (id: string, refUID: string, schemaId: string, timeCreated: number, decodedDataJson = '') => ({
  id,
  refUID,
  schemaId,
  attester: OWNER,
  timeCreated,
  revoked: false,
  decodedDataJson,
})

const seed: AttestationLike = {
  ...att(POST, '0x' + '0'.repeat(64), '0x' + 'd'.repeat(64), 10),
  schema: { schemaNames: [{ name: 'post' }] },
}
const all = [
  att(POST_V, POST, VERSION_SCHEMA_UID, 11),
  att(SIDECAR, POST, '0x' + 'e'.repeat(64), 20),
  att('0xp1', POST_V, '0x' + 'f'.repeat(64), 12, JSON.stringify([{ value: { name: 'title', value: 'Mine', type: 'string' } }])),
]

const matches = (a: Record<string, any>, where: Record<string, any>): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Record<string, any>[]).every((c) => matches(a, c))
    if ('equals' in cond) return a[key] === cond.equals
    if ('in' in cond) return cond.in.includes(a[key])
    if ('notIn' in cond) return !cond.notIn.includes(a[key])
    throw new Error(`unsupported where ${key}`)
  })

const RESULT_KEY: Record<string, string> = { GetVersions: 'itemVersions', GetProperties: 'itemProperties' }

const configure = () => {
  BaseQueryClient.configure({
    getQueryClient: () => ({ fetchQuery: ({ queryFn }: { queryFn: () => unknown }) => queryFn() }),
  } as never)
  BaseEasClient.configure({
    getEasClient: () =>
      ({
        request: async (doc: any, vars: { where: Record<string, any> }) => {
          const key = RESULT_KEY[doc.definitions[0].name.value as string]
          if (!key) throw new Error('unexpected request')
          return { [key]: all.filter((a) => matches(a, vars.where)).sort((a, b) => b.timeCreated - a.timeCreated) }
        },
      }) as never,
  })
}

describe('remote source version schema filter', () => {
  it("doesn't take a same-attester non-version attestation as the head version", async () => {
    configure()
    const [record] = await assembleSeeds('post', [seed], { hydrateStorage: false }, createRemoteQueryDataSource())
    expect(record?.versionUid).toBe(POST_V)
    expect(record?.data.title).toBe('Mine')
  })

  it('reads the same record with a bag anchor on the Version', async () => {
    configure()
    const read = () => assembleSeeds('post', [seed], { hydrateStorage: false }, createRemoteQueryDataSource())
    const before = await read()
    all.push(att('0xanchor', POST_V, ARCHIVE_ANCHOR_SCHEMA_UID, 30, JSON.stringify([{ value: { name: 'covered_until', value: 12, type: 'uint64' } }])))
    expect(await read()).toEqual(before)
    all.pop()
  })
})
