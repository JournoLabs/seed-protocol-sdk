import { afterEach, describe, expect, mock, test } from 'bun:test'

const MANAGED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ADMIN = '0xadadadadadadadadadadadadadadadadadadadad'

let managedAccount: { address: string } | undefined = { address: MANAGED }
const autoConnectMock = mock(() => Promise.resolve())
const ensureManagedAccountEasConfiguredMock = mock(
  async (_managed: string, _sender: unknown): Promise<void> => {},
)
const getManagedAccountAdminMock = mock(async () => ({ address: ADMIN }))

mock.module('../config', () => ({
  getConfigRef: () => null,
  getPublishConfig: () => ({}),
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  syncPublishInAppAuthToken: () => ({}),
  getManagedAccountWallet: () => ({
    autoConnect: autoConnectMock,
    getAccount: () => managedAccount,
  }),
}))

mock.module('./managedAccountAdmin', () => ({
  getManagedAccountAdmin: (...args: unknown[]) => getManagedAccountAdminMock(...(args as [])),
}))

mock.module('./ensureManagedAccountEasConfigured', () => ({
  ensureManagedAccountEasConfigured: (...args: unknown[]) =>
    ensureManagedAccountEasConfiguredMock(...(args as [string, unknown])),
  assertManagedAccountEasMatchesConfig: async () => {},
}))

mock.module('./adapters/thirdwebAccount', () => ({
  fromThirdwebAccount: (account: { address: string }) => ({
    signer: { address: account.address },
    txSender: { address: account.address, sendTransaction: async () => ({ transactionHash: '0x' }) },
  }),
}))

const { ensureModularPublishBootstrap } = await import('./ensureModularPublishBootstrap')

afterEach(() => {
  managedAccount = { address: MANAGED }
  autoConnectMock.mockClear()
  ensureManagedAccountEasConfiguredMock.mockClear()
  ensureManagedAccountEasConfiguredMock.mockImplementation(async () => {})
  getManagedAccountAdminMock.mockClear()
})

describe('ensureModularPublishBootstrap', () => {
  test('returns the managed smart account and checks EAS without connecting the admin', async () => {
    const account = await ensureModularPublishBootstrap(MANAGED)
    expect(account.address).toBe(MANAGED)
    expect(ensureManagedAccountEasConfiguredMock).toHaveBeenCalledTimes(1)
    expect(getManagedAccountAdminMock).not.toHaveBeenCalled()
  })

  test('the legacy setEas fallback sends from the admin EOA', async () => {
    ensureManagedAccountEasConfiguredMock.mockImplementation(async (_managed, sender) => {
      const wallet = await (sender as () => Promise<{ txSender: { address: string } }>)()
      expect(wallet.txSender.address).toBe(ADMIN)
    })
    await ensureModularPublishBootstrap(MANAGED)
    expect(getManagedAccountAdminMock).toHaveBeenCalledWith(MANAGED)
  })

  test('rejects a connected managed account that is not the publishing account', async () => {
    managedAccount = { address: '0x1111111111111111111111111111111111111111' }
    await expect(ensureModularPublishBootstrap(MANAGED)).rejects.toMatchObject({
      code: 'MANAGED_ACCOUNT_UNAVAILABLE',
    })
    expect(ensureManagedAccountEasConfiguredMock).not.toHaveBeenCalled()
  })

  test('fails when the managed wallet is not connected', async () => {
    managedAccount = undefined
    await expect(ensureModularPublishBootstrap(MANAGED)).rejects.toMatchObject({
      code: 'MANAGED_ACCOUNT_UNAVAILABLE',
    })
  })
})
