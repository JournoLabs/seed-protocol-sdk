import { afterEach, describe, expect, mock, test } from 'bun:test'
import { brandSigner, brandTxSender, type PublishWallet } from './seedSigner'

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
const address = '0x1111111111111111111111111111111111111111' as `0x${string}`
const fakeAccount: PublishWallet = {
  signer: brandSigner({
    address,
    signMessage: async () => '0x' as `0x${string}`,
  }),
  txSender: brandTxSender({
    address,
    sendTransaction: sendTransactionMock,
  }),
}

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
    expect(encodeSetEasMock).not.toHaveBeenCalled()
    expect(sendTransactionMock).not.toHaveBeenCalled()
  })

  test('calls setEas when getEas is zero', async () => {
    readGetEasMock.mockImplementation(async () => '0x0000000000000000000000000000000000000000')
    const { ensureManagedAccountEasConfigured } = await import('./ensureManagedAccountEasConfigured')
    await ensureManagedAccountEasConfigured('0xmanaged', fakeAccount)
    expect(encodeSetEasMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalled()
  })
})
