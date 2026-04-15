import { afterEach, describe, expect, mock, test } from 'bun:test'

const publishCfg = {
  easContractAddress: '0x4200000000000000000000000000000000000021',
}

const getEasMock = mock(async () => publishCfg.easContractAddress)
const setEasMock = mock(() => ({}))
const sendTransactionMock = mock(async () => ({ transactionHash: `0x${'ab'.repeat(32)}` }))
const waitForReceiptMock = mock(async () => ({ status: 'success' }))

mock.module('../config', () => ({
  getPublishConfig: () => publishCfg,
}))

mock.module('./thirdweb', () => ({
  getClient: () => ({}),
}))

mock.module('thirdweb', () => ({
  getContract: mock(() => ({})),
  sendTransaction: (...args: unknown[]) => sendTransactionMock(...args),
  waitForReceipt: (...args: unknown[]) => waitForReceiptMock(...args),
}))

mock.module('./thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148', () => ({
  getEas: () => getEasMock(),
  setEas: (...args: unknown[]) => setEasMock(...args),
}))

const fakeAccount = { address: '0x1111111111111111111111111111111111111111' } as import('thirdweb/wallets').Account

afterEach(() => {
  publishCfg.easContractAddress = '0x4200000000000000000000000000000000000021'
  getEasMock.mockClear()
  setEasMock.mockClear()
  sendTransactionMock.mockClear()
  waitForReceiptMock.mockClear()
  getEasMock.mockImplementation(async () => publishCfg.easContractAddress)
})

describe('ensureManagedAccountEasConfigured', () => {
  test('no op when getEas matches config', async () => {
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)
    expect(getEasMock).toHaveBeenCalled()
    expect(setEasMock).not.toHaveBeenCalled()
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })

  test('sends setEas when getEas is zero', async () => {
    getEasMock.mockImplementationOnce(async () => '0x0000000000000000000000000000000000000000')
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)
    expect(setEasMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalledTimes(1)
    expect(waitForReceiptMock).toHaveBeenCalledTimes(1)
  })

  test('sends setEas when getEas mismatches', async () => {
    getEasMock.mockImplementationOnce(async () => '0x1000000000000000000000000000000000000001')
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)
    expect(setEasMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalledTimes(1)
  })

  test('throws ManagedAccountPublishError when getEas fails', async () => {
    getEasMock.mockImplementationOnce(async () => {
      throw new Error('rpc')
    })
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await expect(ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)).rejects.toMatchObject({
      code: 'MANAGED_ACCOUNT_SET_EAS_FAILED',
      managedAddress: '0xmanaged',
    })
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })

  test('throws when config EAS is zero', async () => {
    publishCfg.easContractAddress = '0x0000000000000000000000000000000000000000'
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await expect(ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)).rejects.toMatchObject({
      code: 'MANAGED_ACCOUNT_SET_EAS_FAILED',
    })
  })
})
