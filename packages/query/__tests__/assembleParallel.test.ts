import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { getSeed } from '../src/api'
import { assembleSeeds } from '../src/assembleSeeds'
import { clearLocalQuerySource, registerLocalQuerySource } from '../src/source/index'
import type { QueryDataSource } from '../src/source/types'
import type { AttestationLike } from '../src/types'

const POST = '0x' + 'a'.repeat(64)
const POST_V = '0x' + 'b'.repeat(64)
const AUTHOR = '0x' + 'c'.repeat(64)
const AUTHOR_V = '0x' + 'd'.repeat(64)
const REVOKED_AUTHOR = '0x' + 'e'.repeat(64)
const REVOKED_AUTHOR_V = '0x' + 'f'.repeat(64)

const prop = (id: string, versionUid: string, name: string, value: unknown, type = 'string') => ({
  id,
  refUID: versionUid,
  schemaId: `0xschema-${name}`,
  timeCreated: 20,
  decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
})

const seed = (id: string, schemaName: string): AttestationLike => ({
  id,
  refUID: '0x0',
  schemaId: '0xseedschema',
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

/**
 * A post relating to two authors; REVOKED_AUTHOR's seed is revoked (getSeedsByUids leaves it out)
 * but its version and properties are still there. Every call is logged at start and at end.
 */
function makeSource(log: string[]): QueryDataSource {
  const seeds = new Map([
    [POST, seed(POST, 'post')],
    [AUTHOR, seed(AUTHOR, 'author')],
  ])
  const versions = [
    version(POST_V, POST),
    version(AUTHOR_V, AUTHOR),
    version(REVOKED_AUTHOR_V, REVOKED_AUTHOR),
  ]
  const props = [
    prop('0xp1', POST_V, 'title', 'Hello'),
    prop('0xp2', POST_V, 'author_ids', [AUTHOR, REVOKED_AUTHOR], 'bytes32[]'),
    prop('0xp3', AUTHOR_V, 'name', 'Ada'),
    prop('0xp4', REVOKED_AUTHOR_V, 'name', 'Revoked'),
  ]
  const call = async <T>(name: string, result: T): Promise<T> => {
    log.push(`start ${name}`)
    await new Promise((r) => setTimeout(r, 5))
    log.push(`end ${name}`)
    return result
  }
  return {
    kind: 'local',
    getSeedByUid: (uid) => call('seed', seeds.get(uid) ?? null),
    listSeedsBySchemaName: async () => [],
    listSeedsByUidPrefix: async () => [],
    listSeedsBySchemaNameForMonth: async () => [],
    getVersionsForSeed: async (uid) => versions.filter((v) => v.refUID === uid),
    getVersionsForSeeds: (uids) =>
      call(`versions ${uids.length}`, versions.filter((v) => uids.includes(v.refUID))),
    getPropertiesForVersionUids: (uids) =>
      call('properties', props.filter((p) => uids.includes(p.refUID))),
    getSeedsByUids: (uids) =>
      call('related seeds', uids.map((u) => seeds.get(u)).filter(Boolean) as AttestationLike[]),
  }
}

describe('parallel requests in assembly', () => {
  let log: string[]

  beforeEach(() => {
    log = []
    process.env.CACHE_ENABLED = 'false'
  })

  afterEach(() => {
    clearLocalQuerySource()
    delete process.env.CACHE_ENABLED
  })

  it('fetches related seeds and their versions together', async () => {
    await assembleSeeds('post', [seed(POST, 'post')], { hydrateStorage: false }, makeSource(log))
    const relatedSeeds = log.indexOf('start related seeds')
    const relatedVersions = log.indexOf('start versions 2')
    expect(relatedSeeds).toBeGreaterThan(-1)
    expect(relatedVersions).toBeGreaterThan(-1)
    // Both start before either ends.
    expect(Math.max(relatedSeeds, relatedVersions)).toBeLessThan(
      Math.min(log.indexOf('end related seeds'), log.indexOf('end versions 2')),
    )
  })

  it('does not assemble a related seed that was not returned, even with its versions fetched', async () => {
    const [record] = await assembleSeeds(
      'post',
      [seed(POST, 'post')],
      { hydrateStorage: false },
      makeSource(log),
    )
    const authors = record!.data.authors as Array<Record<string, unknown> | string>
    expect(authors).toEqual([expect.objectContaining({ seedUid: AUTHOR, name: 'Ada' }), REVOKED_AUTHOR])
  })

  it('getSeed fetches the seed and its versions together', async () => {
    registerLocalQuerySource(makeSource(log))
    const record = await getSeed(POST, { source: 'local', hydrateStorage: false })
    expect(record?.data.title).toBe('Hello')

    expect(log.slice(0, 2).sort()).toEqual(['start seed', 'start versions 1'])
    // Assembly reuses those versions instead of asking again.
    expect(log.filter((l) => l === 'start versions 1')).toHaveLength(1)
  })
})
