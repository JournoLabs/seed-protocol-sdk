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
