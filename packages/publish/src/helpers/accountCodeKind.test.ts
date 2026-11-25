import { describe, expect, test } from 'bun:test'
import { accountCodeKind, delegationTarget } from './chainClient'

describe('accountCodeKind', () => {
  test('tells an EOA, an EIP-7702 delegated EOA and a contract apart', () => {
    expect(accountCodeKind(undefined)).toBe('none')
    expect(accountCodeKind('0x')).toBe('none')
    expect(accountCodeKind('0xef0100' + 'ab'.repeat(20))).toBe('eip7702-delegated')
    expect(accountCodeKind('0xEF0100' + 'AB'.repeat(20))).toBe('eip7702-delegated')
    expect(accountCodeKind('0x6080604052')).toBe('contract')
  })
})

describe('delegationTarget', () => {
  test("returns the delegate of an EIP-7702 designator", () => {
    expect(delegationTarget('0xef0100' + 'ab'.repeat(20))).toBe(`0x${'ab'.repeat(20)}`)
    expect(delegationTarget('0xEF0100' + 'AB'.repeat(20))).toBe(`0x${'ab'.repeat(20)}`)
  })
  test('undefined for no code and for contract code', () => {
    expect(delegationTarget(undefined)).toBeUndefined()
    expect(delegationTarget(null)).toBeUndefined()
    expect(delegationTarget('0x')).toBeUndefined()
    expect(delegationTarget('0x6080604052')).toBeUndefined()
  })
})
