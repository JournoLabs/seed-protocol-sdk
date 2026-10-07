import { describe, expect, it } from 'vitest'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@/helpers/easPropertyCanonical'

/** `getCanonicalItemPropertiesFromEas` is `getItemPropertiesFromEas` + this helper; EAS client setup is required to unit-test the wrapper end-to-end. */
describe('getCanonicalItemPropertiesFromEas composition', () => {
  it('uses the same newest-per-(refUID,schemaId) rule as the exported helper', () => {
    const sid = '0x' + '11'.repeat(32)
    const rid = '0x' + 'aa'.repeat(32)
    const fake = [
      { id: 'older', schemaId: sid, refUID: rid, timeCreated: 100 },
      { id: 'newer', schemaId: sid, refUID: rid, timeCreated: 200 },
    ]
    const out = pickLatestPropertyAttestationsByRefAndSchema(fake as never)
    expect(out).toHaveLength(1)
    expect((out[0] as { id: string }).id).toBe('newer')
  })
})

describe('pickLatestPropertyAttestationsByRefAndSchema', () => {
  it('keeps newest attestation per refUID and schemaId', () => {
    const v = '0x' + 'ab'.repeat(32)
    const s1 = '0x' + '01'.repeat(32)
    const s2 = '0x' + '02'.repeat(32)
    const input = [
      { schemaId: s1, refUID: v, timeCreated: 100, id: 'old' },
      { schemaId: s1, refUID: v, timeCreated: 200, id: 'new' },
      { schemaId: s2, refUID: v, timeCreated: 150, id: 'only' },
    ]
    const out = pickLatestPropertyAttestationsByRefAndSchema(input)
    expect(out).toHaveLength(2)
    expect(out.map((a) => a.id).sort()).toEqual(['new', 'only'])
  })

  it('partitions by refUID', () => {
    const s = '0x' + 'cc'.repeat(32)
    const v1 = '0x' + '11'.repeat(32)
    const v2 = '0x' + '22'.repeat(32)
    const input = [
      { schemaId: s, refUID: v1, timeCreated: 300, id: 'a' },
      { schemaId: s, refUID: v2, timeCreated: 100, id: 'b' },
    ]
    const out = pickLatestPropertyAttestationsByRefAndSchema(input)
    expect(out).toHaveLength(2)
  })

  it('keeps first-seen on equal timeCreated and treats missing timeCreated as 0', () => {
    const v = '0x' + 'ab'.repeat(32)
    const s = '0x' + '01'.repeat(32)
    const tie = pickLatestPropertyAttestationsByRefAndSchema([
      { schemaId: s, refUID: v, timeCreated: 100, id: 'first' },
      { schemaId: s, refUID: v, timeCreated: 100, id: 'second' },
    ])
    expect(tie.map((a) => a.id)).toEqual(['first'])
    const missing = pickLatestPropertyAttestationsByRefAndSchema([
      { schemaId: s, refUID: v, id: 'noTime' } as { schemaId: string; refUID: string; id: string; timeCreated?: number },
      { schemaId: s, refUID: v, timeCreated: 1, id: 'timed' },
    ])
    expect(missing.map((a) => a.id)).toEqual(['timed'])
  })

  describe('revoked attestations', () => {
    const v = '0x' + 'ab'.repeat(32)
    const s1 = '0x' + '01'.repeat(32)
    const s2 = '0x' + '02'.repeat(32)

    it('picks the newest non-revoked attestation over a newer revoked one', () => {
      const out = pickLatestPropertyAttestationsByRefAndSchema([
        { schemaId: s1, refUID: v, timeCreated: 100, revoked: false, id: 'old' },
        { schemaId: s1, refUID: v, timeCreated: 200, revoked: false, id: 'live' },
        { schemaId: s1, refUID: v, timeCreated: 300, revoked: true, id: 'revoked' },
      ])
      expect(out.map((a) => a.id)).toEqual(['live'])
    })

    it('omits a (refUID, schemaId) whose attestations are all revoked by default', () => {
      const input = [
        { schemaId: s1, refUID: v, timeCreated: 100, revoked: true, id: 'r1' },
        { schemaId: s1, refUID: v, timeCreated: 200, revoked: true, id: 'r2' },
        { schemaId: s2, refUID: v, timeCreated: 50, revoked: false, id: 'other' },
      ]
      expect(pickLatestPropertyAttestationsByRefAndSchema(input).map((a) => a.id)).toEqual(['other'])
      expect(
        pickLatestPropertyAttestationsByRefAndSchema(input, { ifAllRevoked: 'omit' }).map((a) => a.id),
      ).toEqual(['other'])
    })

    it("returns the newest revoked one when all are revoked and ifAllRevoked is 'newestRevoked'", () => {
      const out = pickLatestPropertyAttestationsByRefAndSchema(
        [
          { schemaId: s1, refUID: v, timeCreated: 100, revoked: true, id: 'r1' },
          { schemaId: s1, refUID: v, timeCreated: 200, revoked: true, id: 'r2' },
          { schemaId: s2, refUID: v, timeCreated: 50, revoked: false, id: 'live2' },
          { schemaId: s2, refUID: v, timeCreated: 90, revoked: true, id: 'revoked2' },
        ],
        { ifAllRevoked: 'newestRevoked' },
      )
      expect(out.map((a) => a.id).sort()).toEqual(['live2', 'r2'])
    })
  })
})
