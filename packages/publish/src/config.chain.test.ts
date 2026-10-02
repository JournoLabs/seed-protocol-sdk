import { afterEach, describe, expect, test } from 'bun:test'
import { base, baseSepolia, sepolia } from 'viem/chains'
import type { Chain } from 'viem'
import {
  getPublishConfig,
  initPublish,
  requireManagedAccountFactoryAddress,
  setConfigRef,
  type PublishConfig,
} from './config'
import { encodeEasMultiRevoke, encodeRegisterSchema } from './helpers/contracts'
import { getPublishChainName } from './helpers/chainConfig'

const OP_EAS = '0x4200000000000000000000000000000000000021'
const OP_REGISTRY = '0x4200000000000000000000000000000000000020'

afterEach(() => {
  setConfigRef(null)
})

function setCfg(partial: Partial<PublishConfig> = {}) {
  setConfigRef({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.invalid', ...partial })
}

const customChain = {
  id: 999_999,
  name: 'Custom EAS Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://custom.invalid'] } },
} as Chain

describe('publish chain resolution', () => {
  test('defaults to Optimism Sepolia with predeploys and the built-in factory', () => {
    setCfg()
    const cfg = getPublishConfig()
    expect(cfg.chain.id).toBe(11155420)
    expect(cfg.easContractAddress).toBe(OP_EAS)
    expect(cfg.schemaRegistryAddress).toBe(OP_REGISTRY)
    expect(cfg.thirdwebAccountFactoryAddress).toBe('0x76f47d88bfaf670f5208911181fcdc0e160cb16d')
    expect(cfg.easChain.explorerUrl).toBe('https://optimism-sepolia.easscan.org')
  })

  test('Base Sepolia uses predeploys but has no built-in factory', () => {
    setCfg({ chain: baseSepolia })
    const cfg = getPublishConfig()
    expect(cfg.easContractAddress).toBe(OP_EAS)
    expect(cfg.thirdwebAccountFactoryAddress).toBeUndefined()
    expect(() => requireManagedAccountFactoryAddress()).toThrow(/managedAccountFactoryAddress/)
    expect(getPublishChainName()).toBe(baseSepolia.name)
  })

  test('non-OP chain (Sepolia) routes EAS and SchemaRegistry txs to its own deployment', () => {
    setCfg({ chain: sepolia })
    const revoke = encodeEasMultiRevoke([{ schema: `0x${'11'.repeat(32)}`, data: [{ uid: `0x${'22'.repeat(32)}` }] }])
    expect(revoke.to.toLowerCase()).toBe('0xc2679fbd37d54388ce493f1db75320d236e1815e')
    const register = encodeRegisterSchema({
      schema: 'string name',
      resolverAddress: '0x0000000000000000000000000000000000000000',
      revocable: true,
    })
    expect(register.to.toLowerCase()).toBe('0x0a7e2ff54e76b8e6659aedc9103fb21c038050d0')
  })

  test('explicit addresses override the known deployment', () => {
    const factory = '0x00000000000000000000000000000000000000fa'
    setCfg({ chain: base, easContractAddress: '0x00000000000000000000000000000000000000ea', managedAccountFactoryAddress: factory })
    const cfg = getPublishConfig()
    expect(cfg.easContractAddress).toBe('0x00000000000000000000000000000000000000ea')
    expect(cfg.schemaRegistryAddress).toBe(OP_REGISTRY)
    expect(requireManagedAccountFactoryAddress()).toBe(factory)
  })

  test('unknown chain requires EAS addresses', () => {
    expect(() =>
      initPublish({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.invalid', chain: customChain }),
    ).toThrow(/Custom EAS Chain \(chain 999999\) has no known EAS deployment/)

    setCfg({
      chain: customChain,
      easContractAddress: '0x0000000000000000000000000000000000000001',
      schemaRegistryAddress: '0x0000000000000000000000000000000000000002',
    })
    const cfg = getPublishConfig()
    expect(cfg.easContractAddress).toBe('0x0000000000000000000000000000000000000001')
    expect(cfg.easChain.name).toBe('Custom EAS Chain')
  })
})
