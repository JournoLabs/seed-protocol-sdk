import { afterEach, describe, expect, mock, test } from 'bun:test'
import { fromThirdwebAccount } from './seedSigner'

const publishCfg = {
  easContractAddress: '0x4200000000000000000000000000000000000021',
}

const readGetEasMock = mock(async () => publishCfg.easContractAddress)
const encodeSetEasMock = mock(() => ({
  to: '0xmanaged' as `0x${string}`,
  data: '0xseteas' as `0x${string}`,
}))
const waitForPublishReceiptMock = mock(async () => ({ status: 'success' }))

mock.module('../config', () => ({
  getPublishConfig: () => publishCfg,
}))

mock.module('./contracts', () => ({
  readGetEas: (...args: unknown[]) => readGetEasMock(...args),
  encodeSetEas: (...args: unknown[]) => encodeSetEasMock(...args),
}))

mock.module('./chainClient', () => ({
  waitForPublishReceipt: (...args: unknown[]) => waitForPublishReceiptMock(...args),
}))

const sendTransactionMock = mock(async () => ({ transactionHash: `0x${'ab'.repeat(32)}` as `0x${string}` }))
const fakeAccount = fromThirdwebAccount({
  address: '0x1111111111111111111111111111111111111111',
  signMessage: async () => '0x',
  sendTransaction: sendTransactionMock,
} as any)

// Override branded signer send to use our mock
;(fakeAccount as any).sendTransaction = sendTransactionMock

afterEach(() => {
  publishCfg.easContractAddress = '0x4200000000000000000000000000000000000021'
  readGetEasMock.mockClear()
  encodeSetEasMock.mockClear()
  sendTransactionMock.mockClear()
  waitForPublishReceiptMock.mockClear()
  readGetEasMock.mockImplementation(async () => publishCfg.easContractAddress)
})

describe('ensureManagedAccountEasConfigured', () => {
  test('no op when getEas matches config', async () => {
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)
    expect(readGetEasMock).toHaveBeenCalled()
    expect(encodeSetEasMock).not.toHaveBeenCalled()
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })

  test('sends setEas when getEas is zero', async () => {
    readGetEasMock.mockImplementationOnce(async () => '0x0000000000000000000000000000000000000000')
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)
    expect(encodeSetEasMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalledTimes(1)
    expect(waitForPublishReceiptMock).toHaveBeenCalledTimes(1)
  })

  test('sends setEas when getEas mismatches', async () => {
    readGetEasMock.mockImplementationOnce(async () => '0x1000000000000000000000000000000000000001')
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)
    expect(encodeSetEasMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalledTimes(1)
  })

  test('throws ManagedAccountPublishError when getEas fails', async () => {
    readGetEasMock.mockImplementationOnce(async () => {
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
