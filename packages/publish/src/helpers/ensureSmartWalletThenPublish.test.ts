import { afterEach, describe, expect, mock, test } from 'bun:test'
import { isPublishWallet, isSeedSigner } from './seedSigner'

const cfg = { useModularExecutor: true as boolean }
const getConnectedManagedAccountAddressMock = mock(() =>
  Promise.resolve('0xmanaged0000000000000000000000000000000001'),
)
const getConnectedModularAccountMock = mock(() =>
  Promise.resolve({ address: '0xmodular0000000000000000000000000000000002' } as import('thirdweb/wallets').Account),
)
const createPublishMock = mock(() => {})
const resolveSmartWalletForPublishMock = mock(() => Promise.resolve({ needsDeploy: true as const }))
const ensureEip7702ModularAccountReadyMock = mock(() => Promise.resolve())

mock.module('../config', () => ({
  getPublishConfig: () => cfg,
}))

mock.module('./ensureEip7702ModularAccountReady', () => ({
  ensureEip7702ModularAccountReady: (...args: unknown[]) => ensureEip7702ModularAccountReadyMock(...args),
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  getModularAccountWallet: () => ({
    autoConnect: mock(() => Promise.resolve()),
    getAccount: () => ({ address: '0x1234567890123456789012345678901234567890' }),
  }),
  getConnectedModularAccount: (...args: unknown[]) => getConnectedModularAccountMock(...args),
  getConnectedManagedAccountAddress: (...args: unknown[]) => getConnectedManagedAccountAddressMock(...args),
  resolveSmartWalletForPublish: (...args: unknown[]) => resolveSmartWalletForPublishMock(...args),
}))

mock.module('./adapters/thirdwebAccount', () => ({
  fromThirdwebAccount: (account: { address: string }) => {
    const SEED_SIGNER_BRAND = Symbol.for('seedprotocol.SeedSigner')
    const SEED_TX_SENDER_BRAND = Symbol.for('seedprotocol.SeedTxSender')
    const address = account.address as `0x${string}`
    const signer = Object.assign(
      { address, signMessage: async () => '0x' as `0x${string}` },
      { [SEED_SIGNER_BRAND]: true as const },
    )
    const txSender = Object.assign(
      {
        address,
        sendTransaction: async () => ({ transactionHash: '0x' as `0x${string}` }),
      },
      { [SEED_TX_SENDER_BRAND]: true as const },
    )
    return { signer, txSender }
  },
}))

mock.module('thirdweb/utils', () => ({
  isContractDeployed: mock(async () => true),
}))

mock.module('../services/publishManager', () => ({
  PublishManager: {
    createPublish: (...args: unknown[]) => createPublishMock(...args),
  },
}))

afterEach(() => {
  cfg.useModularExecutor = true
  getConnectedManagedAccountAddressMock.mockClear()
  getConnectedModularAccountMock.mockClear()
  createPublishMock.mockClear()
  resolveSmartWalletForPublishMock.mockClear()
  ensureEip7702ModularAccountReadyMock.mockClear()
  getConnectedManagedAccountAddressMock.mockImplementation(() =>
    Promise.resolve('0xmanaged0000000000000000000000000000000001'),
  )
  getConnectedModularAccountMock.mockImplementation(() =>
    Promise.resolve({ address: '0xmodular0000000000000000000000000000000002' } as import('thirdweb/wallets').Account),
  )
  ensureEip7702ModularAccountReadyMock.mockImplementation(() => Promise.resolve())
})

const itemStub = {
  seedLocalId: 'seed-1',
  modelName: 'TestModel',
  schemaUid: '0x0000000000000000000000000000000000000000000000000000000000000001',
} as import('@seedprotocol/sdk').Item<any>

describe('ensureSmartWalletThenPublish (useModularExecutor)', () => {
  test('returns managed_not_ready when modular account is not connected', async () => {
    getConnectedModularAccountMock.mockImplementationOnce(() => Promise.resolve(null))
    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')
    const result = await ensureSmartWalletThenPublish(itemStub, null, async () => '0xany')
    expect(result).toEqual({
      outcome: 'managed_not_ready',
      error: expect.objectContaining({
        code: 'MANAGED_ACCOUNT_UNAVAILABLE',
      }),
    })
    expect(createPublishMock).not.toHaveBeenCalled()
  })

  test('calls createPublish with managed address and PublishWallet without blocking on prep', async () => {
    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')
    const modular = { address: '0xmodular0000000000000000000000000000000002' } as import('thirdweb/wallets').Account
    getConnectedModularAccountMock.mockImplementationOnce(() => Promise.resolve(modular))

    const result = await ensureSmartWalletThenPublish(itemStub, null, async () => '0xany')

    expect(result).toEqual({ outcome: 'started' })
    expect(createPublishMock).toHaveBeenCalledTimes(1)
    const [it, address, account, opts] = createPublishMock.mock.calls[0] as [
      typeof itemStub,
      string,
      import('./seedSigner').PublishWallet,
      { dataItemSigner?: import('./seedSigner').SeedSigner },
    ]
    expect(it).toBe(itemStub)
    expect(address).toBe('0xmanaged0000000000000000000000000000000001')
    expect(isPublishWallet(account)).toBe(true)
    expect(account.signer.address.toLowerCase()).toBe(modular.address.toLowerCase())
    expect(isSeedSigner(opts?.dataItemSigner)).toBe(true)
    expect(ensureEip7702ModularAccountReadyMock).not.toHaveBeenCalled()
  })

  test('spawns publish immediately; EIP-7702 readiness is owned by the publish actor', async () => {
    ensureEip7702ModularAccountReadyMock.mockImplementationOnce(() =>
      Promise.reject(new Error('readiness failed')),
    )
    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')

    const result = await ensureSmartWalletThenPublish(itemStub, null, async () => '0xany')

    expect(result).toEqual({ outcome: 'started' })
    expect(createPublishMock).toHaveBeenCalledTimes(1)
    expect(ensureEip7702ModularAccountReadyMock).not.toHaveBeenCalled()
  })

  test('returns managed_not_ready when managed account address is unavailable', async () => {
    getConnectedManagedAccountAddressMock.mockImplementationOnce(() =>
      Promise.reject(new Error('managed wallet unavailable')),
    )
    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')
    const result = await ensureSmartWalletThenPublish(itemStub, null, async () => '0xany')
    expect(result).toEqual({
      outcome: 'managed_not_ready',
      error: expect.objectContaining({
        code: 'MANAGED_ACCOUNT_UNAVAILABLE',
      }),
    })
    expect(createPublishMock).not.toHaveBeenCalled()
  })
})

describe('ensureSmartWalletThenPublish (non-modular)', () => {
  test('uses resolveSmartWalletForPublish and publisher address', async () => {
    cfg.useModularExecutor = false
    const resolvedAccount = { address: '0xeoa000000000000000000000000000000000003' } as import('thirdweb/wallets').Account
    resolveSmartWalletForPublishMock.mockImplementationOnce(() =>
      Promise.resolve({
        address: '0xpublisher00000000000000000000000000000004',
        account: resolvedAccount,
      }),
    )

    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')
    const result = await ensureSmartWalletThenPublish(itemStub, resolvedAccount, async () => '0xany')

    expect(result).toEqual({ outcome: 'started' })
    expect(createPublishMock).toHaveBeenCalledTimes(1)
    const [, address, account] = createPublishMock.mock.calls[0] as [
      unknown,
      string,
      import('./seedSigner').PublishWallet,
    ]
    expect(address).toBe('0xpublisher00000000000000000000000000000004')
    expect(isPublishWallet(account)).toBe(true)
    expect(account.signer.address.toLowerCase()).toBe(resolvedAccount.address.toLowerCase())
    cfg.useModularExecutor = true
  })
})
