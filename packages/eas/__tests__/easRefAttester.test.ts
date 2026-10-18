import { describe, expect, it } from 'vitest'
import {
  keepAttestationsFromRefAttester,
  partitionByRefAttester,
} from '../src/easRefAttester.js'
import { pickLatestPropertyAttestationsByRefAndSchema } from '../src/easPropertyCanonical.js'

const owner = '0x' + 'aa'.repeat(20)
const other = '0x' + 'bb'.repeat(20)
const seedUid = '0x' + '01'.repeat(32)
const versionUid = '0x' + '02'.repeat(32)
const schemaId = '0x' + '03'.repeat(32)

describe('partitionByRefAttester', () => {
  it("drops another account's version of a seed", () => {
    const versions = [
      { id: 'mine', refUID: seedUid, attester: owner },
      { id: 'theirs', refUID: seedUid, attester: other },
    ]
    const { kept, foreign } = partitionByRefAttester(versions, [{ id: seedUid, attester: owner }])
    expect(kept.map((v) => v.id)).toEqual(['mine'])
    expect(foreign.map((v) => v.id)).toEqual(['theirs'])
  })

  it('compares attesters case-insensitively', () => {
    const kept = keepAttestationsFromRefAttester(
      [{ refUID: seedUid, attester: owner.toUpperCase().replace('0X', '0x') }],
      [{ id: seedUid, attester: owner }],
    )
    expect(kept).toHaveLength(1)
  })

  it('keeps children whose parent or attester is unknown', () => {
    const kept = keepAttestationsFromRefAttester(
      [
        { refUID: 'unknown-parent', attester: other },
        { refUID: seedUid, attester: '' },
        { refUID: versionUid, attester: other },
      ],
      [
        { id: seedUid, attester: owner },
        { id: versionUid, attester: null },
      ],
    )
    expect(kept).toHaveLength(3)
  })

  it("keeps a newer foreign property from winning the canonical pick", () => {
    const properties = [
      { id: 'mine', refUID: versionUid, schemaId, attester: owner, timeCreated: 100 },
      { id: 'theirs', refUID: versionUid, schemaId, attester: other, timeCreated: 200 },
    ]
    const canonical = pickLatestPropertyAttestationsByRefAndSchema(
      keepAttestationsFromRefAttester(properties, [{ id: versionUid, attester: owner }]),
    )
    expect(canonical.map((p) => p.id)).toEqual(['mine'])
  })
})

describe('getCanonicalItemPropertiesFromEas', () => {
  const seedAtt = { id: seedUid, refUID: '0x0', attester: owner, timeCreated: 1 }
  const ownVersion = { id: versionUid, refUID: seedUid, attester: owner, timeCreated: 2 }
  const foreignVersionUid = '0x' + '04'.repeat(32)
  const foreignVersion = { id: foreignVersionUid, refUID: seedUid, attester: other, timeCreated: 3 }
  const properties = [
    { id: 'mine', refUID: versionUid, schemaId, attester: owner, timeCreated: 10, revoked: false },
    { id: 'theirs', refUID: versionUid, schemaId, attester: other, timeCreated: 20, revoked: false },
    { id: 'their-version', refUID: foreignVersionUid, schemaId, attester: other, timeCreated: 30, revoked: false },
  ]

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
          request: async (doc: any) => {
            const operation = doc.definitions[0].name.value as string
            if (operation === 'GetProperties') return { itemProperties: properties }
            if (operation === 'GetVersions') return { itemVersions: [ownVersion, foreignVersion] }
            if (operation === 'GetSeedsLean') return { itemSeeds: [seedAtt] }
            throw new Error(`unexpected ${operation}`)
          },
        }) as never,
    })
  }

  it("ignores other accounts' versions and properties by default", async () => {
    await configure()
    const { getCanonicalItemPropertiesFromEas } = await import('../src/api.js')
    const canonical = await getCanonicalItemPropertiesFromEas({ versionUids: [versionUid, foreignVersionUid] })
    expect(canonical.map((p) => p.id)).toEqual(['mine'])
  })

  it('takes every attestation with checkAttesters: false', async () => {
    await configure()
    const { getCanonicalItemPropertiesFromEas } = await import('../src/api.js')
    const canonical = await getCanonicalItemPropertiesFromEas({
      versionUids: [versionUid, foreignVersionUid],
      checkAttesters: false,
    })
    expect(canonical.map((p) => p.id).sort()).toEqual(['their-version', 'theirs'])
  })
})
