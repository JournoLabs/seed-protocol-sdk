import { afterEach, describe, expect, mock, test } from 'bun:test'

const managedAccount = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
const autoConnectMock = mock(() => Promise.resolve())
const getAccountMock = mock(() => managedAccount)
const ensureExecutorModuleInstalledMock = mock(async () => {})
const ensureAutomationSessionKeyMock = mock(async () => {})
const removeAutomationSessionKeyMock = mock(async () => {})
const attestPublishAuthorizationMock = mock(async () => ({
  uid: `0x${'11'.repeat(32)}`,
  schemaUid: `0x${'22'.repeat(32)}`,
  permissionsHash: `0x${'33'.repeat(32)}`,
  grantedAt: 1,
  expiresAt: 0,
  expirationTime: 2,
}))
const revokePublishAuthorizationMock = mock(async () => {})
const getInstalledModulesMock = mock(async () => [
  { implementation: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
])

mock.module('../config', () => ({
  getPublishConfig: () => ({
    modularAccountModuleContract: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }),
  setConfigRef: () => {},
  initPublish: () => {},
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  getManagedAccountWallet: () => ({
    autoConnect: autoConnectMock,
    getAccount: getAccountMock,
  }),
}))

mock.module('thirdweb', () => ({
  getContract: mock(() => ({})),
}))

mock.module('thirdweb/modules', () => ({
  getInstalledModules: (...args: unknown[]) => getInstalledModulesMock(...args),
}))

mock.module('./ensureExecutorModule', () => ({
  ensureExecutorModuleInstalled: (...args: unknown[]) =>
    ensureExecutorModuleInstalledMock(...args),
}))

mock.module('./ensureAutomationSessionKey', () => ({
  ensureAutomationSessionKey: (...args: unknown[]) => ensureAutomationSessionKeyMock(...args),
  removeAutomationSessionKey: (...args: unknown[]) => removeAutomationSessionKeyMock(...args),
  isAutomationSessionActive: mock(async () => true),
}))

mock.module('../services/publishAuthorization', () => ({
  attestPublishAuthorization: (...args: unknown[]) => attestPublishAuthorizationMock(...args),
  revokePublishAuthorization: (...args: unknown[]) => revokePublishAuthorizationMock(...args),
}))

mock.module('./adapters/thirdwebAccount', () => ({
  fromThirdwebAccount: (account: { address: string }) => ({
    signer: { address: account.address, signMessage: async () => '0x' },
    txSender: {
      address: account.address,
      sendTransaction: async () => ({ transactionHash: '0x' }),
    },
  }),
}))

afterEach(() => {
  autoConnectMock.mockClear()
  getAccountMock.mockClear()
  ensureExecutorModuleInstalledMock.mockClear()
  ensureAutomationSessionKeyMock.mockClear()
  removeAutomationSessionKeyMock.mockClear()
  attestPublishAuthorizationMock.mockClear()
  revokePublishAuthorizationMock.mockClear()
  getInstalledModulesMock.mockClear()
  getAccountMock.mockImplementation(() => managedAccount)
  getInstalledModulesMock.mockImplementation(async () => [
    { implementation: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  ])
})

describe('enrollPublishAutomation', () => {
  test('installs module, adds session key, attests sidecar', async () => {
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    const result = await enrollPublishAutomation({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
    })
    expect(ensureExecutorModuleInstalledMock).toHaveBeenCalled()
    expect(ensureAutomationSessionKeyMock).toHaveBeenCalled()
    expect(attestPublishAuthorizationMock).toHaveBeenCalled()
    expect(result.authorization.uid).toMatch(/^0x/)
  })

  test('fails when module not installed after ensure', async () => {
    getInstalledModulesMock.mockImplementationOnce(async () => [])
    const { enrollPublishAutomation } = await import('./enrollPublishAutomation')
    await expect(
      enrollPublishAutomation({
        managedAddress: '0xmanaged',
        sessionKeyAddress: '0xsession',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTOR_MODULE_NOT_INSTALLED' })
  })
})

describe('revokePublishAutomation', () => {
  test('removes session key and revokes sidecar', async () => {
    const { revokePublishAutomation } = await import('./enrollPublishAutomation')
    await revokePublishAutomation({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
      authorizationUid: `0x${'11'.repeat(32)}`,
    })
    expect(removeAutomationSessionKeyMock).toHaveBeenCalled()
    expect(revokePublishAuthorizationMock).toHaveBeenCalled()
  })
})
