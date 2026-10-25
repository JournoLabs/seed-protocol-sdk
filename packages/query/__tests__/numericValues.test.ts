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

// ADR 0010: values as the OP Sepolia indexer returns them for each EAS type.
describe('numeric property values', () => {
  it('assemble as decimal strings', async () => {
    const seed = attestation(POST, '0x0', { schema: { schemaNames: [{ name: 'post' }] } })
    const versions = [attestation(POST_V, POST)]
    const props = [
      property('0xp1', 'old_count', 'uint8', 7),
      property('0xp2', 'word_count', 'string', '1500'),
      property('0xp3', 'published_at', 'uint256', { type: 'BigNumber', hex: '0x68f04700' }),
      property('0xp4', 'delta', 'int256', { type: 'BigNumber', hex: '-0x05' }),
    ]
    const source: QueryDataSource = {
      kind: 'remote',
      getSeedByUid: async (uid) => (uid === POST ? seed : null),
      listSeedsBySchemaName: async () => [seed],
      listSeedsBySchemaNameForMonth: async () => [],
      getVersionsForSeed: async (uid) => versions.filter((v) => v.refUID === uid),
      getVersionsForSeeds: async (uids) => versions.filter((v) => uids.includes(v.refUID)),
      getPropertiesForVersionUids: async (uids) => props.filter((p) => uids.includes(p.refUID)),
      getSeedsByUids: async () => [],
    }
    const [record] = await assembleSeeds('post', [seed], { hydrateStorage: false }, source)
    expect(record?.data).toMatchObject({
      oldCount: '7',
      wordCount: '1500',
      publishedAt: '1760577280',
      delta: '-5',
    })
  })
})
