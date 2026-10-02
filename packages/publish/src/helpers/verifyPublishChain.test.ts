import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { sepolia } from 'viem/chains'

const state = {
  rpcChainId: 11155420,
  deployed: new Set<string>(),
  getChainIdCalls: 0,
}

const chainClientActual = await import('./chainClient')
mock.module('./chainClient', () => ({
  ...chainClientActual,
  getPublishPublicClient: () => ({
    getChainId: async () => {
      state.getChainIdCalls++
      return state.rpcChainId
    },
  }),
  isContractDeployed: async (address: string) => state.deployed.has(address.toLowerCase()),
}))

const { setConfigRef } = await import('../config')
const { verifyPublishChain, resetVerifiedPublishChain, PublishChainConfigError } = await import('./verifyPublishChain')

const OP_EAS = '0x4200000000000000000000000000000000000021'
const OP_REGISTRY = '0x4200000000000000000000000000000000000020'
const OP_FACTORY = '0x76f47d88bfaf670f5208911181fcdc0e160cb16d'

beforeEach(() => {
  resetVerifiedPublishChain()
  state.rpcChainId = 11155420
  state.deployed = new Set([OP_EAS, OP_REGISTRY, OP_FACTORY])
  state.getChainIdCalls = 0
  setConfigRef({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.example/key123' })
})

afterEach(() => {
  setConfigRef(null)
})

describe('verifyPublishChain', () => {
  test('passes on a correctly configured chain and caches the result', async () => {
    await verifyPublishChain()
    await verifyPublishChain()
    expect(state.getChainIdCalls).toBe(1)
  })

  test('rejects an RPC on a different chain', async () => {
    state.rpcChainId = 8453
    await expect(verifyPublishChain()).rejects.toThrow(
      /RPC reports chain 8453, but PublishConfig.chain is OP Sepolia \(11155420\)/,
    )
  })

  test('lists every missing contract and retries after a failure', async () => {
    setConfigRef({
      uploadApiBaseUrl: 'https://example.com',
      rpcUrl: 'https://rpc.example',
      chain: sepolia,
      modularAccountModuleContract: '0x00000000000000000000000000000000000000aa',
    })
    state.rpcChainId = sepolia.id
    state.deployed = new Set()
    const err = await verifyPublishChain().catch((e) => e)
    expect(err).toBeInstanceOf(PublishChainConfigError)
    expect(err.problems).toHaveLength(3) // EAS, registry, module (no factory configured on Sepolia)
    expect(err.message).toContain('no EAS contract at 0xC2679fBD37d54388Ce493F1DB75320D236e1815e')

    state.deployed = new Set([
      '0xc2679fbd37d54388ce493f1db75320d236e1815e',
      '0x0a7e2ff54e76b8e6659aedc9103fb21c038050d0',
      '0x00000000000000000000000000000000000000aa',
    ])
    await expect(verifyPublishChain()).resolves.toBeUndefined()
  })

  test('does not leak RPC keys into errors', async () => {
    state.rpcChainId = 1
    const err = await verifyPublishChain().catch((e) => e)
    expect(err.message).not.toContain('key123')
  })
})
