import { describe, test, expect } from 'bun:test'
import {
  Eip7702ModularAccountPublishError,
  isEip7702ModularAccountPublishError,
  isManagedAccountPublishError,
  isRouterNonModularCoreAccountError,
  ManagedAccountPublishError,
  stringifyUnderlyingCause,
} from '../errors'

describe('ManagedAccountPublishError', () => {
  test('stores code, managedAddress, and underlyingCause', () => {
    const inner = new Error('inner')
    const e = new ManagedAccountPublishError(
      'message',
      'MANAGED_ACCOUNT_NOT_DEPLOYED',
      '0xabc',
      inner,
    )
    expect(e.code).toBe('MANAGED_ACCOUNT_NOT_DEPLOYED')
    expect(e.managedAddress).toBe('0xabc')
    expect(e.underlyingCause).toBe(inner)
    expect(e.name).toBe('ManagedAccountPublishError')
  })

})

describe('Eip7702ModularAccountPublishError', () => {
  test('stores code and modularAddress', () => {
    const e = new Eip7702ModularAccountPublishError(
      'msg',
      'EIP7702_MODULAR_NOT_UPGRADED',
      '0xdef',
      new Error('cause'),
    )
    expect(e.code).toBe('EIP7702_MODULAR_NOT_UPGRADED')
    expect(e.modularAddress).toBe('0xdef')
    expect(e.name).toBe('Eip7702ModularAccountPublishError')
  })

  test('isEip7702ModularAccountPublishError duck-types', () => {
    expect(
      isEip7702ModularAccountPublishError({
        name: 'Eip7702ModularAccountPublishError',
        code: 'EIP7702_MODULAR_DEPLOY_FAILED',
        message: 'x',
      }),
    ).toBe(true)
  })
})

describe('isManagedAccountPublishError', () => {
  test('returns true for instanceof', () => {
    const e = new ManagedAccountPublishError('m', 'EXECUTOR_MODULE_NOT_INSTALLED', '0x1')
    expect(isManagedAccountPublishError(e)).toBe(true)
  })

  test('returns true for duck-typed plain object with name and code', () => {
    expect(
      isManagedAccountPublishError({
        name: 'ManagedAccountPublishError',
        code: 'EXECUTOR_MODULE_NOT_INSTALLED',
        message: 'x',
      }),
    ).toBe(true)
  })

  test('returns false for generic Error', () => {
    expect(isManagedAccountPublishError(new Error('x'))).toBe(false)
  })
})

describe('stringifyUnderlyingCause', () => {
  test('stringifies viem-like object', () => {
    expect(
      stringifyUnderlyingCause({
        shortMessage: 'reverted',
        message: 'execution reverted',
        details: '0x08c379a0',
      }),
    ).toContain('reverted')
  })

  test('stringifies Error with cause', () => {
    const inner = new Error('inner')
    const e = new Error('outer', { cause: inner })
    expect(stringifyUnderlyingCause(e)).toContain('inner')
  })
})

describe('isRouterNonModularCoreAccountError', () => {
  test('detects Router revert from managed account', () => {
    expect(
      isRouterNonModularCoreAccountError(
        new Error('execution reverted: Router: function does not exist.'),
      ),
    ).toBe(true)
  })

  test('false for unrelated errors', () => {
    expect(isRouterNonModularCoreAccountError(new Error('insufficient funds'))).toBe(false)
  })
})
