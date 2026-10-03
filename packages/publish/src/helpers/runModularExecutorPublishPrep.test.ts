import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

const MANAGED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ensureExecutorModuleInstalledMock = mock(async (..._args: unknown[]) => {})

mock.module('../config', () => ({
  getConfigRef: () => null,
  getPublishConfig: () => ({
    useModularExecutor: true,
    modularAccountModuleContract: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }),
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  syncPublishInAppAuthToken: () => {},
  getConnectedManagedAccountAddress: async () => MANAGED,
  isSmartWalletDeployed: async () => true,
  getManagedAccountWallet: () => ({
    autoConnect: async () => {},
    getAccount: () => ({ address: MANAGED }),
  }),
  getModularAccountWallet: () => ({}),
  getConnectedModularAccount: async () => undefined,
  deploySmartWalletContract: async () => {},
  deployManagedAccountViaFactory: async () => {},
  pollSmartWalletDeployed: async () => true,
}))

mock.module('./thirdwebChain', () => ({ getPublishThirdwebChain: () => ({ id: 31337 }) }))
mock.module('./chainConfig', () => ({ getPublishChainName: () => 'Twin' }))
mock.module('./ensureExecutorModule', () => ({
  ensureExecutorModuleInstalled: (...args: unknown[]) => ensureExecutorModuleInstalledMock(...args),
}))

const { runModularExecutorPublishPrep } = await import('./ensureManagedAccountReady')
const { ManagedAccountPublishError } = await import('../errors')

afterEach(() => {
  ensureExecutorModuleInstalledMock.mockClear()
  ensureExecutorModuleInstalledMock.mockImplementation(async () => {})
})

describe('runModularExecutorPublishPrep', () => {
  test('installs the executor when configured', async () => {
    expect(await runModularExecutorPublishPrep()).toEqual({ ok: true, managedAddress: MANAGED })
    expect(ensureExecutorModuleInstalledMock).toHaveBeenCalledTimes(1)
  })

  test('an executor install failure warns but does not block interactive publishing', async () => {
    ensureExecutorModuleInstalledMock.mockImplementation(async () => {
      throw new ManagedAccountPublishError('pinned executor differs', 'EXECUTOR_MODULE_NOT_INSTALLED', MANAGED)
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await runModularExecutorPublishPrep()).toEqual({ ok: true, managedAddress: MANAGED })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('publishing continues')
    } finally {
      warn.mockRestore()
    }
  })
})
