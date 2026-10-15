import { describe, expect, test } from 'bun:test'
import { resolveThirdwebWalletOptions } from './config'
import {
  assertPublishPaymentConfig,
  PublishPaymentConfigError,
  resolvePublishPayment,
  resolvePublishSender,
} from './payment'

describe('resolvePublishSender', () => {
  test('modular executor wins', () => {
    expect(resolvePublishSender({ useModularExecutor: true, bundlerUrl: 'https://b' })).toBe('modular')
  })
  test('bundlerUrl selects the EIP-7702 sender', () => {
    expect(resolvePublishSender({ bundlerUrl: 'https://b' })).toBe('eip7702')
  })
  test("accountMode 'eoa' keeps the wallet even with a bundler", () => {
    expect(resolvePublishSender({ bundlerUrl: 'https://b', accountMode: 'eoa' })).toBe('wallet')
  })
  test('eip7702 without a bundler falls back to the wallet', () => {
    expect(resolvePublishSender({ accountMode: 'eip7702' })).toBe('wallet')
  })
})

describe('resolvePublishPayment', () => {
  test('modular: Thirdweb sponsors by default', () => {
    expect(resolvePublishPayment({ useModularExecutor: true }).gas).toEqual({ payer: 'sponsored', sponsor: 'thirdweb' })
  })
  test('modular: sponsorGas false means the user pays', () => {
    expect(resolvePublishPayment({ useModularExecutor: true, thirdweb: { sponsorGas: false } }).gas.payer).toBe('user')
  })
  test("modular: payment.gas 'user' is the sponsorGas default", () => {
    const config = { useModularExecutor: true, payment: { gas: 'user' as const } }
    expect(resolvePublishPayment(config).gas.payer).toBe('user')
    expect(resolveThirdwebWalletOptions(config).sponsorGas).toBe(false)
  })
  test('eip7702: a paymaster sponsors, with or without paymasterUrl', () => {
    expect(resolvePublishPayment({ bundlerUrl: 'https://b' }).gas).toEqual({ payer: 'sponsored', sponsor: 'paymaster' })
    expect(resolvePublishPayment({ bundlerUrl: 'https://b', paymasterUrl: 'https://p' }).gas.payer).toBe('sponsored')
  })
  test("eip7702: payment.gas 'user' sends unsponsored", () => {
    expect(resolvePublishPayment({ bundlerUrl: 'https://b', payment: { gas: 'user' } }).gas.payer).toBe('user')
  })
  test('wallet: the user pays', () => {
    expect(resolvePublishPayment({}).gas.payer).toBe('user')
  })
  test('storage: operator by default, path from useArweaveBundler', () => {
    expect(resolvePublishPayment({}).storage).toEqual({ payer: 'operator', path: 'l1' })
    expect(resolvePublishPayment({ useArweaveBundler: true }).storage).toEqual({ payer: 'operator', path: 'bundler' })
  })
})

describe('assertPublishPaymentConfig', () => {
  const rejects = (config: Parameters<typeof assertPublishPaymentConfig>[0], message: string) => {
    expect(() => assertPublishPaymentConfig(config)).toThrow(PublishPaymentConfigError)
    expect(() => assertPublishPaymentConfig(config)).toThrow(message)
  }

  test('no payment config is always fine', () => {
    expect(() => assertPublishPaymentConfig({ thirdweb: { sponsorGas: false } })).not.toThrow()
  })
  test("gas 'sponsored' needs a sender that can be sponsored", () => {
    rejects({ payment: { gas: 'sponsored' } }, 'connected wallet')
  })
  test("gas 'sponsored' contradicts sponsorGas false", () => {
    rejects({ useModularExecutor: true, thirdweb: { sponsorGas: false }, payment: { gas: 'sponsored' } }, 'sponsorGas is false')
  })
  test("gas 'user' contradicts sponsorGas true", () => {
    rejects({ useModularExecutor: true, thirdweb: { sponsorGas: true }, payment: { gas: 'user' } }, 'sponsorGas is true')
  })
  test("gas 'user' contradicts a paymasterUrl on the EIP-7702 sender", () => {
    rejects({ bundlerUrl: 'https://b', paymasterUrl: 'https://p', payment: { gas: 'user' } }, 'paymasterUrl is set')
  })
  test('consistent configs pass', () => {
    expect(() => assertPublishPaymentConfig({ useModularExecutor: true, payment: { gas: 'sponsored' } })).not.toThrow()
    expect(() => assertPublishPaymentConfig({ bundlerUrl: 'https://b', payment: { gas: 'user' } })).not.toThrow()
    expect(() => assertPublishPaymentConfig({ payment: { gas: 'user', storage: 'operator' } })).not.toThrow()
  })
  test("storage 'user' is not supported yet", () => {
    rejects({ payment: { storage: 'user' } }, 'not supported yet')
  })
})
