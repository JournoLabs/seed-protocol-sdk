import { describe, expect, it } from 'vitest'
import { INCLUSION_SCHEMA_UID, STAFF_SCHEMA_UID } from '../src/constants.js'
import { decodeInclusionHalf, decodeStaffHalf } from '../src/pairs.js'

const uid = (n: number) => '0x' + n.toString(16).padStart(64, '0')

const json = (fields: Record<string, string>) =>
  JSON.stringify(
    Object.entries(fields).map(([name, value]) => ({
      name,
      type: 'bytes32',
      signature: `bytes32 ${name}`,
      value: { name, type: 'bytes32', value },
    })),
  )

describe('pair half decoders', () => {
  it('decodes an Inclusion half, lowercase', () => {
    const half = {
      schemaId: INCLUSION_SCHEMA_UID,
      decodedDataJson: json({ publication: uid(1).toUpperCase().replace('0X', '0x'), post: uid(2), version: uid(0) }),
    }
    expect(decodeInclusionHalf(half)).toEqual({ publication: uid(1), post: uid(2), version: uid(0) })
  })

  it('decodes a Staff half', () => {
    expect(decodeStaffHalf({ schemaId: STAFF_SCHEMA_UID, decodedDataJson: json({ publication: uid(1), identity: uid(3) }) })).toEqual({
      publication: uid(1),
      identity: uid(3),
    })
  })

  it('returns null for another schema, a missing field or a value that is not bytes32', () => {
    const data = json({ publication: uid(1), identity: uid(3) })
    expect(decodeInclusionHalf({ schemaId: STAFF_SCHEMA_UID, decodedDataJson: data })).toBeNull()
    expect(decodeInclusionHalf({ schemaId: INCLUSION_SCHEMA_UID, decodedDataJson: data })).toBeNull()
    expect(decodeStaffHalf({ schemaId: STAFF_SCHEMA_UID, decodedDataJson: json({ publication: '0x12', identity: uid(3) }) })).toBeNull()
    expect(decodeStaffHalf({ schemaId: STAFF_SCHEMA_UID, decodedDataJson: 'not json' })).toBeNull()
  })
})
