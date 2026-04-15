import { afterEach, describe, expect, mock, test } from 'bun:test'

const cfg = { useModularExecutor: true as boolean }
const runPrepMock = mock(() => Promise.resolve({ ok: true as const, managedAddress: '0xmanaged0000000000000000000000000000000001' }))
const getConnectedModularAccountMock = mock(() =>
  Promise.resolve({ address: '0xmodular0000000000000000000000000000000002' } as import('thirdweb/wallets').Account),
)
const createPublishMock = mock(() => {})
const resolveSmartWalletForPublishMock = mock(() => Promise.resolve({ needsDeploy: true as const }))

mock.module('../config', () => ({
  getPublishConfig: () => cfg,
}))

mock.module('./ensureManagedAccountReady', () => ({
  runModularExecutorPublishPrep: (...args: unknown[]) => runPrepMock(...args),
}))

// Include getClient + getModularAccountWallet so this file does not clobber ./thirdweb for other tests in the same run.
mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  getModularAccountWallet: () => ({
    autoConnect: mock(() => Promise.resolve()),
    getAccount: () => ({ address: '0x1234567890123456789012345678901234567890' }),
  }),
  getConnectedModularAccount: (...args: unknown[]) => getConnectedModularAccountMock(...args),
  resolveSmartWalletForPublish: (...args: unknown[]) => resolveSmartWalletForPublishMock(...args),
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
  runPrepMock.mockClear()
  getConnectedModularAccountMock.mockClear()
  createPublishMock.mockClear()
  resolveSmartWalletForPublishMock.mockClear()
  runPrepMock.mockImplementation(() => Promise.resolve({ ok: true as const, managedAddress: '0xmanaged0000000000000000000000000000000001' }))
  getConnectedModularAccountMock.mockImplementation(() =>
    Promise.resolve({ address: '0xmodular0000000000000000000000000000000002' } as import('thirdweb/wallets').Account),
  )
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

  test('calls createPublish with managed address and modular account after EIP-7702 readiness', async () => {
    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')
    const modular = { address: '0xmodular0000000000000000000000000000000002' } as import('thirdweb/wallets').Account
    getConnectedModularAccountMock.mockImplementationOnce(() => Promise.resolve(modular))

    const result = await ensureSmartWalletThenPublish(itemStub, null, async () => '0xany')

    expect(result).toEqual({ outcome: 'started' })
    expect(createPublishMock).toHaveBeenCalledTimes(1)
    const [it, address, account, opts] = createPublishMock.mock.calls[0] as [
      typeof itemStub,
      string,
      import('thirdweb/wallets').Account,
      { dataItemSigner?: import('thirdweb/wallets').Account },
    ]
    expect(it).toBe(itemStub)
    expect(address).toBe('0xmanaged0000000000000000000000000000000001')
    expect(account).toBe(modular)
    expect(opts?.dataItemSigner).toBe(modular)
  })

  test('returns managed_not_ready when prep fails', async () => {
    const err = new (await import('../errors')).ManagedAccountPublishError('prep', 'MANAGED_ACCOUNT_UNAVAILABLE')
    runPrepMock.mockImplementationOnce(() => Promise.resolve({ ok: false as const, error: err }))
    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')
    const result = await ensureSmartWalletThenPublish(itemStub, null, async () => '0xany')
    expect(result).toEqual({ outcome: 'managed_not_ready', error: err })
    expect(getConnectedModularAccountMock).not.toHaveBeenCalled()
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
    const [, address, account] = createPublishMock.mock.calls[0] as [unknown, string, import('thirdweb/wallets').Account]
    expect(address).toBe('0xpublisher00000000000000000000000000000004')
    expect(account).toBe(resolvedAccount)
    cfg.useModularExecutor = true
  })
})
