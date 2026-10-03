import { describe, expect, test } from 'bun:test'
import { seedTwinConfig } from './seedTwin'

const twinJson = {
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:8545',
  bundlerUrl: 'http://127.0.0.1:4337',
  easGraphqlUrl: 'http://localhost:4000/graphql',
  forkedFrom: { chain: 'optimism-sepolia', chainId: 11155420, block: 49590000 },
  contracts: {
    eas: '0x4200000000000000000000000000000000000021',
    schemaRegistry: '0x4200000000000000000000000000000000000020',
    managedAccountFactory: '0x76F47D88bfaf670F5208911181fCDC0E160cb16d',
    seedProtocolExecutor: '0x2C4a14226061eb934Ff0705905C55c5220b77390',
  },
}

describe('seedTwinConfig', () => {
  test('maps twin.json to publish and SDK settings', () => {
    const twin = seedTwinConfig(twinJson)
    expect(twin.chain.id).toBe(31337)
    expect(twin.chain.rpcUrls.default.http[0]).toBe('http://127.0.0.1:8545')
    expect(twin.publish).toMatchObject({
      rpcUrl: 'http://127.0.0.1:8545',
      easContractAddress: twinJson.contracts.eas,
      schemaRegistryAddress: twinJson.contracts.schemaRegistry,
      managedAccountFactoryAddress: twinJson.contracts.managedAccountFactory,
      modularAccountModuleContract: twinJson.contracts.seedProtocolExecutor,
      thirdweb: { bundlerUrl: 'http://127.0.0.1:4337', sponsorGas: false, modularWalletMode: 'EOA' },
    })
    expect(twin.eas).toEqual({ chainId: 31337, indexerUrl: 'http://localhost:4000/graphql' })
  })

  test('names every missing field', () => {
    expect(() => seedTwinConfig({ ...twinJson, bundlerUrl: '', contracts: { ...twinJson.contracts, seedProtocolExecutor: '' } })).toThrow(
      'twin.json is missing bundlerUrl, contracts.seedProtocolExecutor',
    )
  })
})
