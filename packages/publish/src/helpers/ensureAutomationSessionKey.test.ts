import { afterEach, describe, expect, mock, test } from 'bun:test'

const managedAccount = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
const autoConnectMock = mock(() => Promise.resolve())
const getAccountMock = mock(() => managedAccount)

const shouldUpdateSessionKeyMock = mock(async () => false)
const addSessionKeyMock = mock(() => ({}))
const removeSessionKeyMock = mock(() => ({}))
const readIsActiveSignerMock = mock(async () => true)
const sendTransactionMock = mock(async () => ({ transactionHash: `0x${'cd'.repeat(32)}` }))
const waitForPublishReceiptMock = mock(async () => ({ status: 'success' }))

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
  createThirdwebClient: mock(() => ({})),
  getContract: mock(() => ({})),
  sendTransaction: (...args: unknown[]) => sendTransactionMock(...args),
  prepareTransaction: mock(() => ({})),
  deploySmartAccount: mock(async () => {}),
  defineChain: mock((c: unknown) => c),
}))

mock.module('thirdweb/extensions/erc4337', () => ({
  shouldUpdateSessionKey: (...args: unknown[]) => shouldUpdateSessionKeyMock(...args),
  addSessionKey: (...args: unknown[]) => addSessionKeyMock(...args),
  removeSessionKey: (...args: unknown[]) => removeSessionKeyMock(...args),
}))

mock.module('./contracts', () => ({
  readIsActiveSigner: (...args: unknown[]) => readIsActiveSignerMock(...args),
}))

mock.module('./chainClient', () => ({
  waitForPublishReceipt: (...args: unknown[]) => waitForPublishReceiptMock(...args),
}))

afterEach(() => {
  autoConnectMock.mockClear()
  getAccountMock.mockClear()
  shouldUpdateSessionKeyMock.mockClear()
  addSessionKeyMock.mockClear()
  removeSessionKeyMock.mockClear()
  readIsActiveSignerMock.mockClear()
  sendTransactionMock.mockClear()
  waitForPublishReceiptMock.mockClear()
  getAccountMock.mockImplementation(() => managedAccount)
  shouldUpdateSessionKeyMock.mockImplementation(async () => false)
  readIsActiveSignerMock.mockImplementation(async () => true)
})

describe('ensureAutomationSessionKey', () => {
  test('no op when permissions current and signer active', async () => {
    const { ensureAutomationSessionKey } = await import('./ensureAutomationSessionKey')
    await ensureAutomationSessionKey({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
    })
    expect(addSessionKeyMock).not.toHaveBeenCalled()
    expect(readIsActiveSignerMock).toHaveBeenCalled()
  })

  test('sends addSessionKey when shouldUpdateSessionKey is true', async () => {
    shouldUpdateSessionKeyMock.mockImplementationOnce(async () => true)
    const { ensureAutomationSessionKey } = await import('./ensureAutomationSessionKey')
    await ensureAutomationSessionKey({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
    })
    expect(addSessionKeyMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalledTimes(1)
  })
})

describe('removeAutomationSessionKey', () => {
  test('sends removeSessionKey', async () => {
    const { removeAutomationSessionKey } = await import('./ensureAutomationSessionKey')
    await removeAutomationSessionKey({
      managedAddress: '0xmanaged',
      sessionKeyAddress: '0xsession',
    })
    expect(removeSessionKeyMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalledTimes(1)
  })
})
