import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { ThirdwebClient } from 'thirdweb'

const prepareTransaction = mock((opts: { client: unknown }) => ({ client: opts.client }))
const sendTransaction = mock(async () => ({ transactionHash: '0x' + '11'.repeat(32) }))

// TODO: replace thirdweb/EAS module mocks in publish tests with a real local chain
// (Anvil + deployed EAS), reusing the test-chain setup from permapress / seed-protocol.
mock.module('thirdweb', () => ({
  prepareTransaction,
  sendTransaction,
  // Unused here, but modules that import them must still link under this mock.
  deploySmartAccount: mock(async () => {}),
  getContract: mock(() => ({})),
  defineChain: (chain: unknown) => chain,
  createThirdwebClient: (opts: { clientId?: string; secretKey?: string }) => ({
    clientId: opts.clientId ?? 'from-secret',
    secretKey: opts.secretKey,
  }),
}))

mock.module('thirdweb/chains', () => ({
  optimismSepolia: { id: 11155420, name: 'OP Sepolia' },
  defineChain: (chain: unknown) => chain,
}))

const { setConfigRef } = await import('../../config')
const { getClient, resetPublishThirdwebClient } = await import('../publishThirdwebClient')
const { fromThirdwebAccount } = await import('./thirdwebAccount')
const { takeNonceSlot } = await import('../thirdwebNonceSlot')

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

describe('fromThirdwebAccount nonce keys', () => {
  const tx = { to: '0x0000000000000000000000000000000000000002', data: '0x', nonceKey: 9n } as const

  test('only a pinning wallet says so', () => {
    expect(fromThirdwebAccount(account).txSender.pinsNonceOn).toBeUndefined()
    expect(fromThirdwebAccount(account, { pinsNonce: true }).txSender.pinsNonceOn).toBeDefined()
  })

  test('a pinning wallet offers the key to the nonce hook', async () => {
    let offered: bigint | undefined
    sendTransaction.mockImplementationOnce(async () => {
      offered = takeNonceSlot(account.address)
      return { transactionHash: '0x01' }
    })
    await fromThirdwebAccount(account, { pinsNonce: true }).txSender.sendTransaction(tx)
    expect(offered).toBe(9n)
  })

  test('any other wallet offers none', async () => {
    let offered: bigint | undefined = 1n
    sendTransaction.mockImplementationOnce(async () => {
      offered = takeNonceSlot(account.address)
      return { transactionHash: '0x01' }
    })
    await fromThirdwebAccount(account).txSender.sendTransaction(tx)
    expect(offered).toBeUndefined()
  })

  // Batch 16 item 40
  test('a pinning wallet whose nonce hook never runs reports the key unused, sent or not', async () => {
    const onNonceKeyIgnored = mock(() => {})
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      sendTransaction.mockImplementationOnce(async () => ({ transactionHash: '0x01' }))
      await fromThirdwebAccount(account, { pinsNonce: true }).txSender.sendTransaction({ ...tx, onNonceKeyIgnored })
      expect(onNonceKeyIgnored).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)

      sendTransaction.mockImplementationOnce(async () => {
        throw new Error('Timeout waiting for userOp to be mined')
      })
      await expect(
        fromThirdwebAccount(account, { pinsNonce: true }).txSender.sendTransaction({ ...tx, onNonceKeyIgnored }),
      ).rejects.toThrow('Timeout')
      expect(onNonceKeyIgnored).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  test('a send whose hook took the key reports nothing', async () => {
    const onNonceKeyIgnored = mock(() => {})
    sendTransaction.mockImplementationOnce(async () => {
      takeNonceSlot(account.address)
      return { transactionHash: '0x01' }
    })
    await fromThirdwebAccount(account, { pinsNonce: true }).txSender.sendTransaction({ ...tx, onNonceKeyIgnored })
    expect(onNonceKeyIgnored).not.toHaveBeenCalled()
  })

  test('a pinned send is not retried on a nonce error: a retry would land under a random key', async () => {
    sendTransaction.mockImplementationOnce(async () => {
      throw new Error('nonce too low')
    })
    await expect(
      fromThirdwebAccount(account, { pinsNonce: true }).txSender.sendTransaction(tx),
    ).rejects.toThrow('nonce too low')
    expect(sendTransaction).toHaveBeenCalledTimes(1)
  })
})
