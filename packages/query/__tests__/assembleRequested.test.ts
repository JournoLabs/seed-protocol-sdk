import { describe, expect, it } from 'vitest'
import { assembleSeedRecords, assembleSeedsWithDependencies } from '../src/assembleSeeds'
import type { QueryDataSource } from '../src/source/types'
import type { AttestationLike } from '../src/types'

const A = '0x' + 'a'.repeat(64)
const A_V = '0x' + 'b'.repeat(64)
const B = '0x' + 'c'.repeat(64)
const B_V = '0x' + 'd'.repeat(64)

const C = '0x' + 'e'.repeat(64)
const C_V = '0x' + 'f'.repeat(64)

const seed = (id: string, schemaName = 'post'): AttestationLike => ({
  id,
  refUID: '0x0',
  schemaId: `0xseedschema-${schemaName}`,
  timeCreated: 10,
  decodedDataJson: '',
  schema: { schemaNames: [{ name: schemaName }] },
})

const version = (id: string, seedUid: string): AttestationLike => ({
  id,
  refUID: seedUid,
  schemaId: '0xversion',
  timeCreated: 11,
  decodedDataJson: '',
})

const prop = (id: string, versionUid: string, name: string, value: unknown, type = 'string') => ({
  id,
  refUID: versionUid,
  schemaId: `0xschema-${name}`,
  timeCreated: 20,
  decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
})

/** Post A relates to post B (same schema); author C relates to post B. */
function makeSource(): QueryDataSource {
  const seeds = new Map([
    [A, seed(A)],
    [B, seed(B)],
    [C, seed(C, 'author')],
  ])
  const versions = [version(A_V, A), version(B_V, B), version(C_V, C)]
  const props = [
    prop('0xp1', A_V, 'title', 'A'),
    prop('0xp2', A_V, 'related_post_id', B, 'bytes32'),
    prop('0xp3', B_V, 'title', 'B'),
    prop('0xp4', C_V, 'name', 'Ada'),
    prop('0xp5', C_V, 'featured_post_id', B, 'bytes32'),
  ]
  return {
    kind: 'remote',
    getSeedByUid: async (uid) => seeds.get(uid) ?? null,
    listSeedsBySchemaName: async () => [],
    listSeedsByUidPrefix: async () => [],
    listSeedsBySchemaNameForMonth: async () => [],
    getVersionsForSeed: async (uid) => versions.filter((v) => v.refUID === uid),
    getVersionsForSeeds: async (uids) => versions.filter((v) => uids.includes(v.refUID)),
    getPropertiesForVersionUids: async (uids) => props.filter((p) => uids.includes(p.refUID)),
    getSeedsByUids: async (uids) =>
      uids.map((u) => seeds.get(u)).filter(Boolean) as AttestationLike[],
  }
}

describe('a related seed with the requested schema', () => {
  it('is expanded into the record, not returned as a record of its own', async () => {
    const { records, dependencies } = await assembleSeedsWithDependencies(
      'post',
      [seed(A)],
      { hydrateStorage: false },
      makeSource(),
    )
    expect(records.map((r) => r.seedUid)).toEqual([A])
    expect([...dependencies.keys()]).toEqual([A])
    const related = records[0]!.data.related_post as Record<string, unknown>
    expect(related.seedUid).toBe(B)
    expect(related.title).toBe('B')
  })

  it('is still a record when it was requested too', async () => {
    const { records } = await assembleSeedsWithDependencies(
      'post',
      [seed(A), seed(B)],
      { hydrateStorage: false },
      makeSource(),
    )
    expect(records.map((r) => r.seedUid)).toEqual([A, B])
  })
})

describe('assembleSeedRecords', () => {
  it('assembles seeds of different schemas together, each with its own schema name', async () => {
    const { records, dependencies } = await assembleSeedRecords(
      [seed(C, 'author'), seed(A)],
      { hydrateStorage: false },
      makeSource(),
    )
    expect(records.map((r) => [r.seedUid, r.schemaName])).toEqual([
      [C, 'author'],
      [A, 'post'],
    ])
    expect((records[0]!.data.featured_post as Record<string, unknown>).title).toBe('B')
    expect((records[1]!.data.related_post as Record<string, unknown>).title).toBe('B')
    expect(dependencies.get(C)!.ids).toEqual([C, B])
  })
})
