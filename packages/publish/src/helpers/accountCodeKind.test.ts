import { describe, expect, test } from 'bun:test'
import { accountCodeKind } from './chainClient'

describe('accountCodeKind', () => {
  test('tells an EOA, an EIP-7702 delegated EOA and a contract apart', () => {
    expect(accountCodeKind(undefined)).toBe('none')
    expect(accountCodeKind('0x')).toBe('none')
    expect(accountCodeKind('0xef0100' + 'ab'.repeat(20))).toBe('eip7702-delegated')
    expect(accountCodeKind('0xEF0100' + 'AB'.repeat(20))).toBe('eip7702-delegated')
    expect(accountCodeKind('0x6080604052')).toBe('contract')
  })
})
