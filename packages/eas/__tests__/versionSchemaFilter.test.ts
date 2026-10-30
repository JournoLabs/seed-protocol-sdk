import { describe, expect, it } from 'vitest'
import { keccak256Hex } from '../src/keccak.js'
import {
  ARCHIVE_ANCHOR_SCHEMA_DEF,
  ARCHIVE_ANCHOR_SCHEMA_UID,
  VERSION_SCHEMA_DEF,
  VERSION_SCHEMA_UID,
} from '../src/constants.js'

/**
 * Versions are the attestations under VERSION_SCHEMA_UID whose refUID is the seed. Other
 * attestations reference seeds too (PublishedBy sidecars), and one from the seed's own attester
 * must not be read as a version.
 */
const owner = '0x' + 'aa'.repeat(20)
const seedUid = '0x' + '01'.repeat(32)
const versionUid = '0x' + '02'.repeat(32)
const sidecarUid = '0x' + '03'.repeat(32)
const titleSchema = '0x' + '04'.repeat(32)
const sidecarSchema = '0x' + '05'.repeat(32)

const att = (id: string, refUID: string, schemaId: string, timeCreated: number) => ({
  id,
  refUID,
  schemaId,
  attester: owner,
  timeCreated,
  revoked: false,
  decodedDataJson: '',
})

const seed = att(seedUid, '0x' + '00'.repeat(32), '0x' + '06'.repeat(32), 1)
const version = att(versionUid, seedUid, VERSION_SCHEMA_UID, 2)
// Newer than the version, same attester as the seed.
const sidecar = att(sidecarUid, seedUid, sidecarSchema, 3)
const properties = [att('mine', versionUid, titleSchema, 4), att('on-sidecar', sidecarUid, titleSchema, 5)]
const anchor = att('anchor', versionUid, ARCHIVE_ANCHOR_SCHEMA_UID, 6)
const all = [seed, version, sidecar, ...properties, anchor]

/** Evaluates the where shapes these helpers send; unknown keys fail. */
const matches = (a: Record<string, any>, where: Record<string, any>): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Record<string, any>[]).every((c) => matches(a, c))
    if ('equals' in cond) return a[key] === cond.equals
    if ('in' in cond) return cond.in.includes(a[key])
    if ('notIn' in cond) return !cond.notIn.includes(a[key])
    throw new Error(`unsupported where ${key}`)
  })

const RESULT_KEY: Record<string, string> = {
  GetVersions: 'itemVersions',
  GetProperties: 'itemProperties',
  GetSeedsLean: 'itemSeeds',
}

const configure = async () => {
  const { BaseEasClient } = await import('../src/EasClient/BaseEasClient.js')
  const { BaseQueryClient } = await import('../src/QueryClient/BaseQueryClient.js')
  BaseQueryClient.configure({
    getQueryClient: () => ({
      fetchQuery: ({ queryFn }: { queryFn: () => unknown }) => queryFn(),
      getQueryData: () => undefined,
      removeQueries: async () => {},
    }),
  } as never)
  BaseEasClient.configure({
    getEasClient: () =>
      ({
        request: async (doc: any, vars: { where: Record<string, any> }) => {
          const key = RESULT_KEY[doc.definitions[0].name.value as string]
          if (!key) throw new Error('unexpected request')
          const rows = all.filter((a) => matches(a, vars.where)).sort((a, b) => b.timeCreated - a.timeCreated)
          return { [key]: rows }
        },
      }) as never,
  })
}

describe('version schema filter', () => {
  it('getItemVersionsFromEas returns only Version attestations', async () => {
    await configure()
    const { getItemVersionsFromEas } = await import('../src/api.js')
    for (const excludeRevoked of [true, false]) {
      const versions = await getItemVersionsFromEas({ seedUids: [seedUid], excludeRevoked })
      expect(versions.map((v) => v.id)).toEqual([versionUid])
    }
  })

  it('getCanonicalItemPropertiesFromEas drops properties on a non-version attestation', async () => {
    await configure()
    const { getCanonicalItemPropertiesFromEas } = await import('../src/api.js')
    const canonical = await getCanonicalItemPropertiesFromEas({ versionUids: [versionUid, sidecarUid] })
    expect(canonical.map((p) => p.id)).toEqual(['mine'])
  })

  it('leaves bag anchors out of property reads', async () => {
    await configure()
    const { getCanonicalItemPropertiesFromEas, getItemPropertiesFromEas } = await import('../src/api.js')
    for (const excludeRevoked of [true, false]) {
      const properties = await getItemPropertiesFromEas({ versionUids: [versionUid], excludeRevoked })
      expect(properties.map((p) => p.id)).toEqual(['mine'])
    }
    const canonical = await getCanonicalItemPropertiesFromEas({ versionUids: [versionUid] })
    expect(canonical.map((p) => p.id)).toEqual(['mine'])
  })

  it('pins the schema UIDs to their definitions', () => {
    // SchemaRegistry._getUID: keccak256(abi.encodePacked(schema, resolver, revocable))
    const schemaUid = (definition: string) =>
      `0x${keccak256Hex(new Uint8Array([...new TextEncoder().encode(definition), ...new Uint8Array(20), 1]))}`
    expect(schemaUid(VERSION_SCHEMA_DEF)).toBe(VERSION_SCHEMA_UID)
    expect(schemaUid(ARCHIVE_ANCHOR_SCHEMA_DEF)).toBe(ARCHIVE_ANCHOR_SCHEMA_UID)
  })
})
