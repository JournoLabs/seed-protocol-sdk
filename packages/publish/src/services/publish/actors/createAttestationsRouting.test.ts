import { describe, expect, mock, test } from 'bun:test'

mock.module('../../../helpers/thirdweb', () => ({
  isSmartWalletDeployed: mock(async () => true),
  getClient: () => ({}),
  getManagedAccountWallet: () => ({ autoConnect: async () => {}, getAccount: () => null }),
  getModularAccountWallet: () => ({ autoConnect: async () => {}, getAccount: () => null }),
}))

mock.module('../../../helpers/ensureManagedAccountReady', () => ({
  runModularExecutorPublishPrep: mock(async () => ({ ok: true, managedAddress: '0xmanaged' })),
}))

mock.module('thirdweb', () => ({
  createThirdwebClient: mock(() => ({})),
  deploySmartAccount: mock(async () => {}),
  getContract: mock(() => ({})),
  prepareTransaction: mock(() => ({})),
  sendTransaction: mock(async () => ({ transactionHash: '0x' })),
  defineChain: mock((c: unknown) => c),
}))

const { MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA } = await import('../../../helpers/constants')
const { resolvePublishRouting } = await import('./createAttestations')

describe('resolvePublishRouting', () => {
  test('uses publisher contract as multiPublish target in non-modular mode', () => {
    const publisher = '0xabc0000000000000000000000000000000000001'
    const routing = resolvePublishRouting({
      useModularExecutor: false,
      publisherAddress: publisher,
    })
    expect(routing).toEqual({
      txTargetAddress: publisher,
      contractAddressForEvents: publisher,
    })
  })

  test('uses managed address target in modular mode', () => {
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: '0xmanaged',
    })
    expect(routing).toEqual({
      txTargetAddress: '0xmanaged',
      contractAddressForEvents: '0xmanaged',
    })
  })

  test('prefers module contract as event source in modular mode', () => {
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: '0xmanaged',
      modularAccountModuleContract: '0xmodule',
    })
    expect(routing).toEqual({
      txTargetAddress: '0xmanaged',
      contractAddressForEvents: '0xmodule',
    })
  })

  test('throws in modular mode when managedAddress missing', () => {
    expect(() =>
      resolvePublishRouting({
        useModularExecutor: true,
        publisherAddress: '0xabc',
      }),
    ).toThrow('managedAddress is required')
  })

  test('modular tx target is never the ABI reference deployment (regression guard)', () => {
    const managed = '0x05c1a02815bf9c634763d63b8df5573b3a00ef08'
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: managed,
    })
    expect(routing.txTargetAddress.toLowerCase()).toBe(managed.toLowerCase())
    expect(routing.txTargetAddress.toLowerCase()).not.toBe(
      MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA.toLowerCase(),
    )
  })
})
