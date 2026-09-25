import { afterEach, describe, expect, mock, test } from 'bun:test'

const managedAccount = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
const autoConnectMock = mock(() => Promise.resolve())
const getAccountMock = mock(() => managedAccount)

const shouldUpdateSessionKeyMock = mock(async () => false)
const addSessionKeyMock = mock(() => ({}))
const removeSessionKeyMock = mock(() => ({}))
const readIsActiveSignerMock = mock(async () => true)
const isContractDeployedMock = mock(async () => true)
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
  isContractDeployed: (...args: unknown[]) => isContractDeployedMock(...args),
}))

afterEach(() => {
  autoConnectMock.mockClear()
  getAccountMock.mockClear()
  shouldUpdateSessionKeyMock.mockClear()
  addSessionKeyMock.mockClear()
  removeSessionKeyMock.mockClear()
  readIsActiveSignerMock.mockClear()
  isContractDeployedMock.mockClear()
  sendTransactionMock.mockClear()
  waitForPublishReceiptMock.mockClear()
  getAccountMock.mockImplementation(() => managedAccount)
  shouldUpdateSessionKeyMock.mockImplementation(async () => false)
  readIsActiveSignerMock.mockImplementation(async () => true)
  isContractDeployedMock.mockImplementation(async () => true)
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

describe('isAutomationSessionActive', () => {
  test('returns false when the ManagedAccount has no bytecode', async () => {
    isContractDeployedMock.mockImplementationOnce(async () => false)
    const { isAutomationSessionActive } = await import('./ensureAutomationSessionKey')
    await expect(isAutomationSessionActive('0xmanaged', '0xsession')).resolves.toBe(false)
    expect(readIsActiveSignerMock).not.toHaveBeenCalled()
  })

  test('returns true when deployed and isActiveSigner is true', async () => {
    const { isAutomationSessionActive } = await import('./ensureAutomationSessionKey')
    await expect(isAutomationSessionActive('0xmanaged', '0xsession')).resolves.toBe(true)
    expect(readIsActiveSignerMock).toHaveBeenCalled()
  })

  test('returns false when deployed and isActiveSigner is false', async () => {
    readIsActiveSignerMock.mockImplementationOnce(async () => false)
    const { isAutomationSessionActive } = await import('./ensureAutomationSessionKey')
    await expect(isAutomationSessionActive('0xmanaged', '0xsession')).resolves.toBe(false)
  })

  test('throws MODULAR_SIGNER_ACTIVATION_FAILED when bytecode read fails', async () => {
    isContractDeployedMock.mockImplementationOnce(async () => {
      throw new Error('RPC timeout')
    })
    const { isAutomationSessionActive } = await import('./ensureAutomationSessionKey')
    const { isManagedAccountPublishError } = await import('../errors')
    try {
      await isAutomationSessionActive('0xmanaged', '0xsession')
      throw new Error('expected throw')
    } catch (e) {
      expect(isManagedAccountPublishError(e)).toBe(true)
      expect((e as { code: string }).code).toBe('MODULAR_SIGNER_ACTIVATION_FAILED')
    }
    expect(readIsActiveSignerMock).not.toHaveBeenCalled()
  })

  test('throws when deployed and isActiveSigner returns empty 0x', async () => {
    readIsActiveSignerMock.mockImplementationOnce(async () => {
      throw new Error('Cannot decode zero data ("0x") — address is not a contract.')
    })
    const { isAutomationSessionActive } = await import('./ensureAutomationSessionKey')
    const { isManagedAccountPublishError } = await import('../errors')
    try {
      await isAutomationSessionActive('0xmanaged', '0xsession')
      throw new Error('expected throw')
    } catch (e) {
      expect(isManagedAccountPublishError(e)).toBe(true)
      expect((e as { code: string }).code).toBe('MODULAR_SIGNER_ACTIVATION_FAILED')
    }
  })
})
