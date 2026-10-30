import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { assembleSeeds } from '../src/assembleSeeds'
import type { QueryDataSource } from '../src/source/types'
import type { AttestationLike } from '../src/types'

const OWNER = '0x' + '1'.repeat(40)
const POST = '0x' + 'a'.repeat(64)
const POST_V = '0x' + 'b'.repeat(64)
const PERSON = '0x' + 'c'.repeat(64)
const placeholder = (n: number) => '0x' + n.toString(16).padStart(64, '0')

const attestation = (id: string, refUID: string, extra: Partial<AttestationLike> = {}): AttestationLike => ({
  id,
  refUID,
  attester: OWNER,
  schemaId: '0xschema',
  timeCreated: 10,
  decodedDataJson: '',
  ...extra,
})

const property = (id: string, name: string, type: string, value: unknown) =>
  attestation(id, POST_V, {
    schemaId: `0xschema-${name}`,
    decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
  })

// A relation value below 2^32 is a reference slot the publisher's multiPublish never filled.
describe('unfilled references', () => {
  it('leave a relation holding one out of the seed, drop it from a list, and fetch neither', async () => {
    const seed = attestation(POST, '0x0', { schema: { schemaNames: [{ name: 'post' }] } })
    const versions = [attestation(POST_V, POST)]
    const props = [
      property('0xp1', 'author', 'bytes32', placeholder(2)),
      property('0xp2', 'tag_ids', 'bytes32[]', [PERSON, placeholder(1)]),
    ]
    const getSeedsByUids = vi.fn(async () => [])
    const source: QueryDataSource = {
      kind: 'remote',
      getSeedByUid: async (uid) => (uid === POST ? seed : null),
      listSeedsBySchemaName: async () => [seed],
      listSeedsBySchemaNameForMonth: async () => [],
      getVersionsForSeed: async (uid) => versions.filter((v) => v.refUID === uid),
      getVersionsForSeeds: async (uids) => versions.filter((v) => uids.includes(v.refUID)),
      getPropertiesForVersionUids: async (uids) => props.filter((p) => uids.includes(p.refUID)),
      getSeedsByUids,
    }
    const [record] = await assembleSeeds('post', [seed], { hydrateStorage: false, relations: 'uids' }, source)
    expect(record?.data).not.toHaveProperty('author')
    expect(record?.data).toMatchObject({ tags: [PERSON] })
    const fetched = getSeedsByUids.mock.calls.flatMap((call) => (call as unknown[])[0] as string[])
    expect(fetched).not.toContain(placeholder(1))
    expect(fetched).not.toContain(placeholder(2))
  })
})
