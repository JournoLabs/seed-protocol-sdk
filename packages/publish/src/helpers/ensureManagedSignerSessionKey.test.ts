import { afterEach, describe, expect, mock, test } from 'bun:test'

const managedAccount = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
const autoConnectMock = mock(() => Promise.resolve())
const getAccountMock = mock(() => managedAccount)

const shouldUpdateSessionKeyMock = mock(async () => false)
const addSessionKeyMock = mock(() => ({}))
const readIsActiveSignerMock = mock(async () => true)
const sendTransactionMock = mock(async () => ({ transactionHash: `0x${'cd'.repeat(32)}` }))
const waitForPublishReceiptMock = mock(async () => ({ status: 'success' }))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
  getManagedAccountWallet: () => ({
    autoConnect: autoConnectMock,
    getAccount: getAccountMock,
  }),
}))

mock.module('thirdweb', () => ({
  getContract: mock(() => ({})),
  sendTransaction: (...args: unknown[]) => sendTransactionMock(...args),
}))

mock.module('thirdweb/extensions/erc4337', () => ({
  shouldUpdateSessionKey: (...args: unknown[]) => shouldUpdateSessionKeyMock(...args),
  addSessionKey: (...args: unknown[]) => addSessionKeyMock(...args),
}))

mock.module('./contracts', () => ({
  readIsActiveSigner: (...args: unknown[]) => readIsActiveSignerMock(...args),
}))

mock.module('./chainClient', () => ({
  waitForPublishReceipt: (...args: unknown[]) => waitForPublishReceiptMock(...args),
}))

mock.module('./defaultApprovedTargetsForModularPublish', () => ({
  defaultApprovedTargetsForModularPublish: () => ['0xmanaged'],
}))

afterEach(() => {
  autoConnectMock.mockClear()
  getAccountMock.mockClear()
  shouldUpdateSessionKeyMock.mockClear()
  addSessionKeyMock.mockClear()
  readIsActiveSignerMock.mockClear()
  sendTransactionMock.mockClear()
  waitForPublishReceiptMock.mockClear()
  getAccountMock.mockImplementation(() => managedAccount)
  shouldUpdateSessionKeyMock.mockImplementation(async () => false)
  readIsActiveSignerMock.mockImplementation(async () => true)
})

describe('ensureManagedSignerSessionKey', () => {
  test('no op when signer already active and permissions current', async () => {
    const { ensureManagedSignerSessionKey } = await import('./ensureManagedSignerSessionKey')
    await ensureManagedSignerSessionKey({
      managedAddress: '0xmanaged',
      signerAddress: '0xsigner',
    })
    expect(addSessionKeyMock).not.toHaveBeenCalled()
    expect(sendTransactionMock).not.toHaveBeenCalled()
    expect(readIsActiveSignerMock).toHaveBeenCalled()
  })

  test('sends addSessionKey when shouldUpdateSessionKey is true', async () => {
    shouldUpdateSessionKeyMock.mockImplementationOnce(async () => true)
    const { ensureManagedSignerSessionKey } = await import('./ensureManagedSignerSessionKey')
    await ensureManagedSignerSessionKey({
      managedAddress: '0xmanaged',
      signerAddress: '0xsigner',
    })
    expect(addSessionKeyMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalledTimes(1)
    expect(waitForPublishReceiptMock).toHaveBeenCalledTimes(1)
  })

  test('throws when managed wallet has no account', async () => {
    getAccountMock.mockImplementationOnce(() => null)
    const { ensureManagedSignerSessionKey } = await import('./ensureManagedSignerSessionKey')
    await expect(
      ensureManagedSignerSessionKey({
        managedAddress: '0xmanaged',
        signerAddress: '0xsigner',
      }),
    ).rejects.toMatchObject({
      code: 'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress: '0xmanaged',
    })
  })

  test('throws when signer is not active after activation attempt', async () => {
    readIsActiveSignerMock.mockImplementationOnce(async () => false)
    const { ensureManagedSignerSessionKey } = await import('./ensureManagedSignerSessionKey')
    await expect(
      ensureManagedSignerSessionKey({
        managedAddress: '0xmanaged',
        signerAddress: '0xsigner',
      }),
    ).rejects.toMatchObject({
      code: 'MODULAR_SIGNER_ACTIVATION_FAILED',
    })
  })
})
