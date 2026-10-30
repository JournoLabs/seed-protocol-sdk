import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { assembleSeeds } from '../src/assembleSeeds'
import { assembleSeedChangelog } from '../src/assembleChangelog'
import type { QueryDataSource } from '../src/source/types'
import type { AttestationLike } from '../src/types'

const OWNER = '0x' + '1'.repeat(40)
const OTHER = '0x' + '2'.repeat(40)
const POST = '0x' + 'a'.repeat(64)
const POST_V = '0x' + 'b'.repeat(64)
const FOREIGN_V = '0x' + 'c'.repeat(64)

const attestation = (
  id: string,
  refUID: string,
  attester: string,
  timeCreated: number,
  extra: Partial<AttestationLike> = {},
): AttestationLike => ({
  id,
  refUID,
  attester,
  schemaId: '0xschema',
  timeCreated,
  decodedDataJson: '',
  ...extra,
})

const title = (id: string, versionUid: string, attester: string, timeCreated: number, value: string) =>
  attestation(id, versionUid, attester, timeCreated, {
    schemaId: '0xschema-title',
    decodedDataJson: JSON.stringify([{ value: { name: 'title', value, type: 'string' } }]),
  })

/**
 * The owner's post has one version with title "Mine". Another account attested a newer title on
 * that version, and a newer version of the post with its own title.
 */
function makeSource(): QueryDataSource {
  const seed = attestation(POST, '0x0', OWNER, 10, { schema: { schemaNames: [{ name: 'post' }] } })
  const versions = [attestation(POST_V, POST, OWNER, 11), attestation(FOREIGN_V, POST, OTHER, 30)]
  const props = [
    title('0xp1', POST_V, OWNER, 12, 'Mine'),
    title('0xp2', POST_V, OTHER, 20, 'Hijacked'),
    title('0xp3', FOREIGN_V, OTHER, 31, 'Hijacked version'),
  ]
  return {
    kind: 'remote',
    getSeedByUid: async (uid) => (uid === POST ? seed : null),
    listSeedsBySchemaName: async () => [seed],
    listSeedsBySchemaNameForMonth: async () => [],
    getVersionsForSeed: async (uid) => versions.filter((v) => v.refUID === uid),
    getVersionsForSeeds: async (uids) => versions.filter((v) => uids.includes(v.refUID)),
    getPropertiesForVersionUids: async (uids) => props.filter((p) => uids.includes(p.refUID)),
    getSeedsByUids: async () => [],
  }
}

describe("another account's attestations on a seed", () => {
  it("don't win in assembled records", async () => {
    const source = makeSource()
    const seed = await source.getSeedByUid(POST)
    const [record] = await assembleSeeds('post', [seed!], { hydrateStorage: false }, source)
    expect(record?.data.title).toBe('Mine')
    expect(record?.latestVersionUid ?? POST_V).toBe(POST_V)
  })

  it("don't appear in the changelog", async () => {
    const { latestVersionUid, changelog } = await assembleSeedChangelog(POST, undefined, makeSource())
    expect(latestVersionUid).toBe(POST_V)
    expect(JSON.stringify(changelog)).not.toContain('Hijacked')
  })
})
