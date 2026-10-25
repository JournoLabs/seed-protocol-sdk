import { describe, expect, it } from 'vitest'
import { assembleSeedRecords } from '../src/assembleSeeds'
import type { VersionPin } from '../src/types'
import type { QueryDataSource } from '../src/source/types'
import type { AttestationLike } from '../src/types'

const POST = '0x' + '1'.repeat(64)
const V1 = '0x' + '2'.repeat(64)
const V2 = '0x' + '3'.repeat(64)
const V_REVOKED = '0x' + '4'.repeat(64)
const AUTHOR = '0x' + '5'.repeat(64)
const AUTHOR_V1 = '0x' + '6'.repeat(64)
const AUTHOR_V2 = '0x' + '7'.repeat(64)

const seed = (id: string, schemaName: string): AttestationLike => ({
  id,
  refUID: '0x0',
  schemaId: `0xseed-${schemaName}`,
  timeCreated: 10,
  decodedDataJson: '',
  schema: { schemaNames: [{ name: schemaName }] },
})

const version = (id: string, seedUid: string, timeCreated: number, revoked = false) => ({
  id,
  refUID: seedUid,
  schemaId: '0xversion',
  timeCreated,
  decodedDataJson: '',
  revoked,
})

const prop = (
  id: string,
  versionUid: string,
  name: string,
  value: unknown,
  timeCreated: number,
  type = 'string',
) => ({
  id,
  refUID: versionUid,
  schemaId: `0xschema-${name}`,
  timeCreated,
  decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
})

/**
 * A post with V1 (t=11, patched at t=40) and V2 (t=30), plus a revoked version (t=35). Every
 * version names the author, whose latest version is AUTHOR_V2.
 */
function makeSource(): QueryDataSource {
  const seeds = new Map([
    [POST, seed(POST, 'post')],
    [AUTHOR, seed(AUTHOR, 'author')],
  ])
  const versions = [
    version(V1, POST, 11),
    version(V2, POST, 30),
    version(V_REVOKED, POST, 35, true),
    version(AUTHOR_V1, AUTHOR, 11),
    version(AUTHOR_V2, AUTHOR, 30),
  ]
  const props = [
    prop('0xa1', V1, 'title', 'First', 12),
    prop('0xa2', V1, 'author_id', AUTHOR, 12, 'bytes32'),
    prop('0xa3', V1, 'title', 'First, patched', 40),
    prop('0xb1', V2, 'title', 'Second', 31),
    prop('0xb2', V2, 'author_id', AUTHOR, 31, 'bytes32'),
    prop('0xc1', V_REVOKED, 'title', 'Revoked', 36),
    prop('0xd1', AUTHOR_V1, 'name', 'Ada', 12),
    prop('0xd2', AUTHOR_V2, 'name', 'Ada Lovelace', 31),
  ]
  return {
    kind: 'remote',
    getSeedByUid: async (uid) => seeds.get(uid) ?? null,
    listSeedsBySchemaName: async () => [],
    listSeedsBySchemaNameForMonth: async () => [],
    getVersionsForSeed: async (uid) => versions.filter((v) => v.refUID === uid && !v.revoked),
    getVersionsForSeeds: async (uids, opts) =>
      versions.filter((v) => uids.includes(v.refUID) && (opts?.includeRevoked || !v.revoked)),
    getPropertiesForVersionUids: async (uids) => props.filter((p) => uids.includes(p.refUID)),
    getSeedsByUids: async (uids) =>
      uids.map((u) => seeds.get(u)).filter(Boolean) as AttestationLike[],
  }
}

const assemblePinned = (pin: VersionPin, seedUid = POST) =>
  assembleSeedRecords([seed(POST, 'post')], { hydrateStorage: false }, makeSource(), {
    pins: new Map([[seedUid, pin]]),
  })

describe('pinned versions', () => {
  it('assembles the latest version without a pin', async () => {
    const { records } = await assembleSeedRecords(
      [seed(POST, 'post')],
      { hydrateStorage: false },
      makeSource(),
    )
    expect(records[0]!.versionUid).toBe(V2)
    expect(records[0]!.data.title).toBe('Second')
  })

  it('assembles the pinned version, with patches made to it', async () => {
    const { records, dependencies } = await assemblePinned({ versionUid: V1 })
    expect(records[0]!.versionUid).toBe(V1)
    expect(records[0]!.data.title).toBe('First, patched')
    expect(dependencies.get(POST)!.refUIDs).toContain(V1)
    expect(dependencies.get(POST)!.refUIDs).not.toContain(V2)
  })

  it('leaves out property attestations made after asOf', async () => {
    const { records } = await assemblePinned({ versionUid: V1, asOf: 39 })
    expect(records[0]!.data.title).toBe('First')
  })

  it('expands related seeds at their latest version', async () => {
    const { records } = await assemblePinned({ versionUid: V1, asOf: 20 })
    const author = records[0]!.data.author as Record<string, unknown>
    expect(author.name).toBe('Ada Lovelace')
  })

  it('matches the version and seed UIDs in any case', async () => {
    const { records } = await assemblePinned(
      { versionUid: V1.toUpperCase().replace('0X', '0x') },
      POST.toUpperCase().replace('0X', '0x'),
    )
    expect(records[0]!.versionUid).toBe(V1)
  })

  it.each([
    ['a version of another seed', { versionUid: AUTHOR_V1 }],
    ['an unknown version', { versionUid: '0x' + '9'.repeat(64) }],
    ['a revoked version', { versionUid: V_REVOKED }],
    ['a version created after asOf', { versionUid: V2, asOf: 29 }],
  ])('returns no record for %s', async (_, pin) => {
    const { records, dependencies } = await assemblePinned(pin)
    expect(records).toEqual([])
    expect(dependencies.size).toBe(0)
  })
})
