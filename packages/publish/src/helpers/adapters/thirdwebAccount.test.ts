import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ThirdwebClient } from 'thirdweb'

const prepareTransaction = mock((opts: { client: unknown }) => ({ client: opts.client }))
const sendTransaction = mock(async () => ({ transactionHash: '0x' + '11'.repeat(32) }))

mock.module('thirdweb', () => ({
  prepareTransaction,
  sendTransaction,
  defineChain: (chain: unknown) => chain,
  createThirdwebClient: (opts: { clientId?: string; secretKey?: string }) => ({
    clientId: opts.clientId ?? 'from-secret',
    secretKey: opts.secretKey,
  }),
}))

mock.module('thirdweb/chains', () => ({
  optimismSepolia: { id: 11155420, name: 'OP Sepolia' },
}))

const { setConfigRef } = await import('../../config')
const { getClient, resetPublishThirdwebClient } = await import('../publishThirdwebClient')
const { fromThirdwebAccount } = await import('./thirdwebAccount')

const account = {
  address: '0x0000000000000000000000000000000000000001',
  signMessage: async () => '0x',
} as import('thirdweb/wallets').Account

beforeEach(() => {
  prepareTransaction.mockClear()
  sendTransaction.mockClear()
  resetPublishThirdwebClient()
  setConfigRef({
    uploadApiBaseUrl: 'http://127.0.0.1:9',
    thirdwebClientId: 'cid-fallback',
    rpcUrl: 'https://example.invalid/rpc',
  })
})

describe('fromThirdwebAccount client', () => {
  test('uses the passed client for prepareTransaction', async () => {
    const passed = { clientId: 'passed', secretKey: 'sek' } as ThirdwebClient
    const wallet = fromThirdwebAccount(account, { client: passed })
    await wallet.txSender.sendTransaction({
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
    })
    expect(prepareTransaction.mock.calls[0]?.[0].client).toBe(passed)
  })

  test('falls back to getClient()', async () => {
    const wallet = fromThirdwebAccount(account)
    await wallet.txSender.sendTransaction({
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
    })
    expect(prepareTransaction.mock.calls[0]?.[0].client).toEqual(getClient())
  })
})
