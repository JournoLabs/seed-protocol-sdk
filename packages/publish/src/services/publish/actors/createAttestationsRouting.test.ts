import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

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

// Loading config first breaks an import cycle (config → … → services/publish) that fails this file
// when it runs on its own.
await import('../../../config')
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
      attesterAddress: publisher,
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
      attesterAddress: '0xmanaged',
    })
  })

  test('keeps the account as target and attester when a module is configured', () => {
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: '0xmanaged',
      modularAccountModuleContract: '0xmodule',
    })
    expect(routing).toEqual({
      txTargetAddress: '0xmanaged',
      attesterAddress: '0xmanaged',
    })
  })

  test('automation route sends multiPublish to the executor module', () => {
    const module = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const routing = resolvePublishRouting({
      useModularExecutor: true,
      publisherAddress: '0xabc',
      managedAddress: '0xmanaged',
      modularAccountModuleContract: module,
      routeToExecutorModule: true,
    })
    expect(routing).toEqual({
      txTargetAddress: module,
      attesterAddress: '0xmanaged',
    })
  })

  test('automation route requires a valid executor module address', () => {
    expect(() =>
      resolvePublishRouting({
        useModularExecutor: true,
        publisherAddress: '0xabc',
        managedAddress: '0xmanaged',
        routeToExecutorModule: true,
      }),
    ).toThrow(/modularAccountModuleContract is required/)
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

describe('resolveMultiPublishSender: the Seed delegate', () => {
  const EOA_KEY = '0x' + '11'.repeat(32)
  const DELEGATE = ('0x' + '5e'.repeat(20)) as `0x${string}`
  const OP_EAS = '0x4200000000000000000000000000000000000021'
  const DELEGATE_CODE = '0x6080604052' + '63a1263421' + '14'
  const HASH = ('0x' + 'c'.repeat(64)) as `0x${string}`

  const chain = { code: '0x' as string, calls: [] as Array<{ stateOverride?: unknown }>, estimates: [] as Array<{ stateOverride?: unknown }> }
  const spies: { mockRestore: () => void }[] = []
  afterEach(async () => {
    for (const spy of spies.splice(0)) spy.mockRestore()
    const { setConfigRef } = await import('~/config')
    setConfigRef(null)
    chain.code = '0x'
    chain.calls = []
    chain.estimates = []
  })

  const setUp = async (seedDelegateAddress: string | undefined) => {
    const { setConfigRef } = await import('~/config')
    setConfigRef({ uploadApiBaseUrl: 'https://example.com', rpcUrl: 'https://rpc.invalid', accountMode: 'eip7702', seedDelegateAddress })
    const chainClient = await import('~/helpers/chainClient')
    const contracts = await import('~/helpers/contracts')
    const easSetup = await import('~/helpers/ensureManagedAccountEasConfigured')
    const { resetSeedDelegateEasCache } = await import('~/helpers/seedDelegate')
    resetSeedDelegateEasCache()
    const client = {
      getCode: async ({ address }: { address: string }) => (address.toLowerCase() === DELEGATE ? DELEGATE_CODE : chain.code),
      getBytecode: async ({ address }: { address: string }) => (address.toLowerCase() === DELEGATE ? DELEGATE_CODE : chain.code),
      call: async (args: { stateOverride?: unknown }) => (chain.calls.push(args), { data: '0x' }),
      estimateGas: async (args: { stateOverride?: unknown }) => (chain.estimates.push(args), 1_000_000n),
      getBlock: async () => ({ gasLimit: 30_000_000n }),
    }
    const easConfigured = spyOn(easSetup, 'ensureManagedAccountEasConfigured').mockImplementation(async () => {})
    spies.push(
      spyOn(chainClient, 'getPublishPublicClient').mockImplementation(() => client as never),
      spyOn(contracts, 'readGetEas').mockImplementation(async () => OP_EAS as `0x${string}`),
      easConfigured,
    )
    const { Wallet } = await import('ethers')
    const { brandTxSender, fromEthersWallet } = await import('~/helpers/seedSigner')
    const base = fromEthersWallet(new Wallet(EOA_KEY))
    const eoa = base.signer.address
    const sent: Array<{ to: string }> = []
    const wallet = {
      ...base,
      txSender: brandTxSender({
        address: eoa,
        delegatesTo: DELEGATE,
        sendTransaction: async (tx) => (sent.push(tx), { transactionHash: HASH }),
      }),
    }
    return { eoa, wallet, sent, easConfigured }
  }

  const sendThrough = async (eoa: string, wallet: unknown) => {
    const { resolveMultiPublishSender } = await import('./createAttestations')
    const route = await resolveMultiPublishSender({ address: eoa as `0x${string}`, wallet })
    await route.sendMultiPublish([], (send) => send())
    return route
  }

  test('a delegated EOA attests with multiPublish to itself', async () => {
    const { eoa, wallet, sent, easConfigured } = await setUp(DELEGATE)
    chain.code = '0xef0100' + DELEGATE.slice(2)
    const { resolveAttestationStrategy } = await import('./checking')
    expect(await resolveAttestationStrategy(eoa, wallet.txSender)).toBe('multiPublish')
    const route = await sendThrough(eoa, wallet)
    expect(route.attesterAddress).toBe(eoa)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe(eoa)
    // A delegated EOA's code is real: no override.
    expect(chain.calls[0]!.stateOverride).toBeUndefined()
    // ensureManagedAccountEasConfigured is not called on the delegate route.
    expect(easConfigured).not.toHaveBeenCalled()
  })

  test('an undelegated EOA with a configured delegate also routes to multiPublish', async () => {
    const { eoa, wallet, sent, easConfigured } = await setUp(DELEGATE)
    const { resolveAttestationStrategy } = await import('./checking')
    expect(await resolveAttestationStrategy(eoa, wallet.txSender)).toBe('multiPublish')
    await sendThrough(eoa, wallet)
    expect(sent[0]!.to).toBe(eoa)
    // Simulated and estimated with the delegate's code at the EOA.
    expect(chain.calls[0]!.stateOverride).toEqual([{ address: eoa, code: DELEGATE_CODE }])
    expect(chain.estimates[0]!.stateOverride).toEqual([{ address: eoa, code: DELEGATE_CODE }])
    expect(easConfigured).not.toHaveBeenCalled()
  })

  test('without a delegate configured, a delegated EOA stays on direct EAS', async () => {
    const { eoa, wallet } = await setUp(undefined)
    chain.code = '0xef0100' + DELEGATE.slice(2)
    const { resolveAttestationStrategy } = await import('./checking')
    expect(await resolveAttestationStrategy(eoa, wallet.txSender)).toBe('directEas')
  })
})
