import { describe, expect, mock, test } from 'bun:test'

const calls: Array<{ owned: string[]; watched: string[] }> = []
const stored = { owned: ['0x0000000000000000000000000000000000000001'], watched: ['0x00000000000000000000000000000000000000ee'] }

mock.module('@seedprotocol/sdk', () => ({
  client: {
    isInitialized: () => true,
    onReady: (cb: () => void) => cb(),
    getAddresses: async () => ({ ...stored }),
    setAddresses: async (next: { owned: string[]; watched: string[] }) => {
      calls.push(next)
    },
    claimUnpublishedDrafts: async () => {},
  },
}))

const { setPublishWallet } = await import('./publishWalletRegistry')

describe('setPublishWallet', () => {
  test('replaces owned addresses with the wallet and keeps watched ones', async () => {
    const wallet = '0x00000000000000000000000000000000000000aa'
    await setPublishWallet({
      signer: { address: wallet },
      txSender: { address: wallet },
    } as never)
    expect(calls).toEqual([{ owned: [wallet], watched: stored.watched }])
  })
})
