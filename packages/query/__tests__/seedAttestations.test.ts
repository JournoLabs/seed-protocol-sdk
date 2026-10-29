import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AttestationLike } from '../src/types'
import type { SeedAttestations } from '../src/seedAttestations'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { clearLocalQuerySource, getSeedAttestations, registerLocalQuerySource } from '../src/index'

const ATTESTER = '0x' + 'a'.repeat(40)
const uid = (tag: string) => '0x' + tag.repeat(32)
const SEED = uid('a1')
const V1 = uid('b1')
const V2 = uid('b2')
const AUTHOR = uid('d1')

let n = 0
const attestation = (fields: Partial<AttestationLike>): AttestationLike => ({
  id: '0xee' + (++n).toString(16).padStart(62, '0'),
  refUID: '0x' + '0'.repeat(64),
  schemaId: '0xschema',
  timeCreated: 1,
  decodedDataJson: '',
  attester: ATTESTER,
  ...fields,
})
const property = (versionUid: string, type: string, name: string, value: unknown, timeCreated: number, attester = ATTESTER) =>
  attestation({
    refUID: versionUid,
    schemaId: `0xschema-${type}-${name}`,
    timeCreated,
    attester,
    decodedDataJson: JSON.stringify([{ value: { name, type, value } }]),
  })

const seeds = [attestation({ id: SEED, schema: { schemaNames: [{ name: 'post' }] } })]
const versions = [attestation({ id: V1, refUID: SEED, timeCreated: 100 }), attestation({ id: V2, refUID: SEED, timeCreated: 200 })]
const properties = [
  property(V1, 'string', 'title', 'First', 101),
  property(V2, 'string', 'title', 'Second', 201),
  property(V2, 'string', 'title', 'Not the attester', 202, '0x' + 'b'.repeat(40)),
  property(V2, 'string', 'summary', '', 203),
  property(V2, 'bool', 'featured', true, 204),
  property(V2, 'uint256', 'published_at', { type: 'BigNumber', hex: '0x10' }, 205),
  property(V2, 'bytes32', 'author_identity_id', AUTHOR, 206),
]

beforeAll(() =>
  registerLocalQuerySource({
    kind: 'local',
    getSeedByUid: async (id) => seeds.find((s) => s.id === id) ?? null,
    getSeedsByUids: async (ids) => seeds.filter((s) => ids.includes(s.id)),
    listSeedsBySchemaName: async () => [],
    listSeedsBySchemaNameForMonth: async () => [],
    getVersionsForSeed: async (id) => versions.filter((v) => v.refUID === id),
    getVersionsForSeeds: async (ids) => versions.filter((v) => ids.includes(v.refUID)),
    getPropertiesForVersionUids: async (ids) => properties.filter((p) => ids.includes(p.refUID)),
  }),
)
afterAll(() => clearLocalQuerySource())

const byName = (entry: SeedAttestations) =>
  Object.fromEntries(entry.properties.map((p) => [p.easName, p]))

describe('getSeedAttestations', () => {
  it("gives the head Version's canonical attestations from the seed's attester, with EAS types", async () => {
    const found = await getSeedAttestations([SEED], { source: 'local' })
    const entry = found.get(SEED)!
    expect(entry.record.versionUid).toBe(V2)
    expect(entry.record.data.title).toBe('Second')
    const props = byName(entry)
    expect(Object.keys(props).sort()).toEqual(['author_identity_id', 'featured', 'published_at', 'title'])
    expect(props.title).toMatchObject({ easType: 'string', value: 'Second', isRelation: false })
    expect(props.featured).toMatchObject({ easType: 'bool', value: true })
    expect(props.published_at).toMatchObject({ easType: 'uint256', value: '16' })
    expect(props.author_identity_id).toMatchObject({ easType: 'bytes32', value: AUTHOR, isRelation: true })
  })

  it('reads a pinned version', async () => {
    const found = await getSeedAttestations([SEED], { source: 'local', pins: new Map([[SEED, { versionUid: V1 }]]) })
    expect(found.get(SEED)!.properties.map((p) => [p.easName, p.value])).toEqual([['title', 'First']])
  })

  it('keys results as given and leaves out seeds it does not find', async () => {
    const given = SEED.toUpperCase().replace('0X', '0x')
    const found = await getSeedAttestations([given, uid('ff')], { source: 'local' })
    expect([...found.keys()]).toEqual([given])
  })
})
