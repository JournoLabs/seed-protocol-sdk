import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { Chain } from 'viem'

type InAppOptions = { executionMode: Record<string, any> }
const created: InAppOptions[] = []

const realWallets = await import('thirdweb/wallets')
mock.module('thirdweb/wallets', () => ({
  ...realWallets,
  inAppWallet: (options: InAppOptions) => {
    created.push(options)
    return { id: 'inApp', options }
  },
}))

const { setConfigRef } = await import('../config')
const { getManagedAccountWallet, getModularAccountWallet, getWalletsForConnectButton } = await import('./thirdweb')

const twin = {
  id: 31337,
  name: 'Seed twin',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
} as Chain
const FACTORY = '0x76F47D88bfaf670F5208911181fCDC0E160cb16d'

const twinConfig = {
  uploadApiBaseUrl: 'https://example.com',
  chain: twin,
  rpcUrl: 'http://127.0.0.1:8545',
  easContractAddress: '0x4200000000000000000000000000000000000021',
  schemaRegistryAddress: '0x4200000000000000000000000000000000000020',
  managedAccountFactoryAddress: FACTORY,
  useModularExecutor: true,
  thirdweb: { bundlerUrl: 'http://127.0.0.1:4337', sponsorGas: false, modularWalletMode: 'EOA' as const },
}

afterEach(() => {
  setConfigRef(null)
  created.length = 0
})

describe('in-app wallets follow publish config', () => {
  test('default config: sponsored 4337 managed wallet and sponsored 7702 admin EOA', () => {
    setConfigRef({ uploadApiBaseUrl: 'https://example.com', thirdwebClientId: 't' })
    const managed = getManagedAccountWallet() as unknown as { options: InAppOptions }
    expect(managed.options.executionMode).toMatchObject({
      mode: 'EIP4337',
      smartAccount: { sponsorGas: true, factoryAddress: '0x76f47d88bfaf670f5208911181fcdc0e160cb16d' },
    })
    expect(managed.options.executionMode.smartAccount.overrides).toBeUndefined()
    const modular = getModularAccountWallet() as unknown as { options: InAppOptions }
    expect(modular.options.executionMode).toEqual({ mode: 'EIP7702', sponsorGas: true })
  })

  test('twin config: local RPC and bundler, no sponsorship, plain EOA admin', () => {
    setConfigRef(twinConfig)
    const managed = getManagedAccountWallet() as unknown as { options: InAppOptions }
    const smartAccount = managed.options.executionMode.smartAccount
    expect(smartAccount.chain.id).toBe(31337)
    expect(smartAccount.chain.rpc).toBe('http://127.0.0.1:8545')
    expect(smartAccount.sponsorGas).toBe(false)
    expect(smartAccount.overrides).toEqual({ bundlerUrl: 'http://127.0.0.1:4337' })
    expect(smartAccount.factoryAddress).toBe(FACTORY)
    const modular = getModularAccountWallet() as unknown as { options: InAppOptions }
    expect(modular.options.executionMode).toEqual({ mode: 'EOA' })
  })

  test('reuses a wallet until its settings change, then rebuilds it', () => {
    setConfigRef(twinConfig)
    const first = getManagedAccountWallet()
    expect(getManagedAccountWallet()).toBe(first)
    setConfigRef({ ...twinConfig, thirdweb: { ...twinConfig.thirdweb, bundlerUrl: 'http://127.0.0.1:4338' } })
    expect(getManagedAccountWallet()).not.toBe(first)
  })

  test('ConnectButton gets wallets for the config it passes, before the ref is set', () => {
    setConfigRef(null)
    const [wallet] = getWalletsForConnectButton(twinConfig) as unknown as Array<{ options: InAppOptions }>
    expect(wallet?.options.executionMode).toEqual({ mode: 'EOA' })
  })
})
