import { afterEach, describe, expect, mock, test } from 'bun:test'

/**
 * ensureWalletThenPublish with `useModularExecutor`: a registered wallet that sends as the
 * ManagedAccount publishes as it is; any other registration goes to the Thirdweb flow.
 */

const MANAGED = '0x00000000000000000000000000000000000000cc'
const ADMIN = '0x00000000000000000000000000000000000000ad'

const realConfig = await import('../config')
mock.module('../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: true }),
}))

let session: unknown
const realRegistry = await import('./publishWalletRegistry')
mock.module('./publishWalletRegistry', () => ({ ...realRegistry, getPublishWallet: () => session }))

const thirdwebFlow = mock(async () => ({ outcome: 'no_address' as const }))
mock.module('./ensureSmartWalletThenPublish', () => ({ ensureSmartWalletThenPublish: thirdwebFlow }))

const createPublish = mock(async (..._args: unknown[]) => ({ id: 'publish' }))
mock.module('../services/publishManager', () => ({ PublishManager: { createPublish } }))

const { ensureWalletThenPublish } = await import('./ensureWalletThenPublish')

const registration = (signer: string, sender: string, publisherAddress: string) => ({
  kind: 'modular',
  publisherAddress,
  signer: { address: signer, signMessage: async () => '0x' },
  txSender: { address: sender, sendTransaction: async () => ({ transactionHash: '0x' }) },
})
const item = {} as never

afterEach(() => {
  thirdwebFlow.mockClear()
  createPublish.mockClear()
})

describe('ensureWalletThenPublish with useModularExecutor', () => {
  test('a wallet that sends as the ManagedAccount publishes as it is', async () => {
    session = registration(ADMIN, MANAGED, MANAGED)
    await expect(ensureWalletThenPublish(item)).resolves.toMatchObject({ outcome: 'started' })
    expect(thirdwebFlow).not.toHaveBeenCalled()
    expect(createPublish.mock.calls[0]?.[1]).toBe(MANAGED)
    expect(createPublish.mock.calls[0]?.[2]).toBe(session)
  })

  test("ConnectButton's in-app EOA, publishing for the ManagedAccount, goes to the Thirdweb flow", async () => {
    session = registration(ADMIN, ADMIN, MANAGED)
    await ensureWalletThenPublish(item)
    expect(thirdwebFlow).toHaveBeenCalled()
    expect(createPublish).not.toHaveBeenCalled()
  })

  test('an EOA registered as its own publisher goes to the Thirdweb flow', async () => {
    session = registration(ADMIN, ADMIN, ADMIN)
    await ensureWalletThenPublish(item)
    expect(thirdwebFlow).toHaveBeenCalled()
    expect(createPublish).not.toHaveBeenCalled()
  })
})
