import { describe, it, expect } from 'vitest'
import {
  encodeBytes32,
  ZERO_BYTES32,
  ZERO_ADDRESS,
} from '../../../publish/src/helpers/easDirect'

describe('easDirect helpers', () => {
  it('encodeBytes32 encodes a bytes32 value', () => {
    const schemaUid = '0x' + '1'.repeat(64) as `0x${string}`
    const result = encodeBytes32(schemaUid)
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result.startsWith('0x')).toBe(true)
  })

  it('ZERO_BYTES32 and ZERO_ADDRESS are defined', () => {
    expect(ZERO_BYTES32).toBe('0x' + '0'.repeat(64))
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000')
  })
})
