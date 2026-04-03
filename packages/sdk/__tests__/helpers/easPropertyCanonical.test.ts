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
})
