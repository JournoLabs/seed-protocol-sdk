import { afterEach, describe, expect, mock, test } from 'bun:test'

const managedAccount = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
const autoConnectMock = mock(() => Promise.resolve())
const getAccountMock = mock(() => managedAccount)

const shouldUpdateSessionKeyMock = mock(async () => false)
const addSessionKeyMock = mock(() => ({}))
const isActiveSignerMock = mock(async () => true)
const sendTransactionMock = mock(async () => ({ transactionHash: `0x${'cd'.repeat(32)}` }))
const waitForReceiptMock = mock(async () => ({ status: 'success' }))

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
  waitForReceipt: (...args: unknown[]) => waitForReceiptMock(...args),
}))

mock.module('thirdweb/extensions/erc4337', () => ({
  shouldUpdateSessionKey: (...args: unknown[]) => shouldUpdateSessionKeyMock(...args),
  addSessionKey: (...args: unknown[]) => addSessionKeyMock(...args),
}))

mock.module('./thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148', () => ({
  isActiveSigner: (...args: unknown[]) => isActiveSignerMock(...args),
}))

mock.module('./defaultApprovedTargetsForModularPublish', () => ({
  defaultApprovedTargetsForModularPublish: () => ['0xmanaged'],
}))

afterEach(() => {
  autoConnectMock.mockClear()
  getAccountMock.mockClear()
  shouldUpdateSessionKeyMock.mockClear()
  addSessionKeyMock.mockClear()
  isActiveSignerMock.mockClear()
  sendTransactionMock.mockClear()
  waitForReceiptMock.mockClear()
  getAccountMock.mockImplementation(() => managedAccount)
  shouldUpdateSessionKeyMock.mockImplementation(async () => false)
  isActiveSignerMock.mockImplementation(async () => true)
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
    expect(isActiveSignerMock).toHaveBeenCalled()
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
    expect(waitForReceiptMock).toHaveBeenCalledTimes(1)
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
    isActiveSignerMock.mockImplementationOnce(async () => false)
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
