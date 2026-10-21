import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { assembleSeeds } from '../src/assembleSeeds'
import { buildFlatSnapshotFromProperties, diffPropertyAttestations } from '../src/changelog'
import type { QueryDataSource } from '../src/source/types'
import type { AttestationLike } from '../src/types'

const OWNER = '0x' + '1'.repeat(40)
const POST = '0x' + 'a'.repeat(64)
const POST_V = '0x' + 'b'.repeat(64)
const ZERO = '0x' + '0'.repeat(64)

const attestation = (id: string, refUID: string, extra: Partial<AttestationLike> = {}): AttestationLike => ({
  id,
  refUID,
  attester: OWNER,
  schemaId: '0xschema',
  timeCreated: 10,
  decodedDataJson: '',
  ...extra,
})

const property = (id: string, name: string, type: string, value: unknown, timeCreated = 10) =>
  attestation(id, POST_V, {
    schemaId: `0xschema-${name}`,
    timeCreated,
    decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
  })

// ADR 0021: a removal attests the EAS type's empty value; readers treat the property as absent.
describe('removed properties', () => {
  it("leave '' and zero bytes32 values out of the seed, and fetch no zero uid", async () => {
    const seed = attestation(POST, '0x0', { schema: { schemaNames: [{ name: 'post' }] } })
    const versions = [attestation(POST_V, POST)]
    const props = [
      property('0xp1', 'title', 'string', ''),
      property('0xp2', 'cover_image', 'bytes32', ZERO),
      property('0xp3', 'tag_ids', 'bytes32[]', []),
      property('0xp4', 'summary', 'string', 'kept'),
    ]
    const getSeedsByUids = vi.fn(async () => [])
    const source: QueryDataSource = {
      kind: 'remote',
      getSeedByUid: async (uid) => (uid === POST ? seed : null),
      listSeedsBySchemaName: async () => [seed],
      listSeedsByUidPrefix: async () => [],
      listSeedsBySchemaNameForMonth: async () => [],
      getVersionsForSeed: async (uid) => versions.filter((v) => v.refUID === uid),
      getVersionsForSeeds: async (uids) => versions.filter((v) => uids.includes(v.refUID)),
      getPropertiesForVersionUids: async (uids) => props.filter((p) => uids.includes(p.refUID)),
      getSeedsByUids,
    }
    const [record] = await assembleSeeds('post', [seed], { hydrateStorage: false }, source)
    expect(record?.data).not.toHaveProperty('title')
    expect(record?.data).not.toHaveProperty('coverImage')
    expect(record?.data).not.toHaveProperty('cover_image')
    expect(record?.data).toMatchObject({ summary: 'kept' })
    const fetched = getSeedsByUids.mock.calls.flatMap((call) => (call as unknown[])[0] as string[])
    expect(fetched).not.toContain(ZERO)
  })

  it('show as removed in the changelog', () => {
    const added = property('0xp1', 'cover_image', 'bytes32', '0x' + 'c'.repeat(64), 10)
    const removed = property('0xp2', 'cover_image', 'bytes32', ZERO, 20)

    expect(buildFlatSnapshotFromProperties([removed])).toEqual({})
    const entries = diffPropertyAttestations([added, removed])
    expect(entries.map((e) => [e.attestationUid, e.previousValue, e.nextValue])).toEqual([
      ['0xp1', undefined, '0x' + 'c'.repeat(64)],
      ['0xp2', '0x' + 'c'.repeat(64), undefined],
    ])
  })
})
