import { describe, expect, test } from 'bun:test'
// Load the publish machine first: its actors and the config import each other.
import '../config'
import { ethers } from 'ethers'
import { fromEthersWallet, type SeedSigner } from './seedSigner'
import { defaultDataItemSigner } from './publishWalletRegistry'
import { arweaveBlobStore } from '../blobStore/arweave'

const upload = {
  blob: new Blob([new TextEncoder().encode('<p>hello</p>')]),
  tags: [{ name: 'Content-Type', value: 'text/html' }],
  itemPropertyName: 'body',
  itemPropertyLocalId: 'p1',
  seedLocalId: 's1',
  versionLocalId: 'v1',
} as never

describe('defaultDataItemSigner', () => {
  const eoa = fromEthersWallet(ethers.Wallet.createRandom())
  const smart = { ...fromEthersWallet(ethers.Wallet.createRandom()), kind: 'smart' as const }

  test("uses the wallet's own dataItemSigner, else an EOA's signer, never a smart account's", () => {
    expect(defaultDataItemSigner(eoa)).toBe(eoa.signer)
    expect(defaultDataItemSigner(smart)).toBeUndefined()
    expect(defaultDataItemSigner({ ...smart, dataItemSigner: eoa.signer })).toBe(eoa.signer)
    expect(defaultDataItemSigner(null)).toBeUndefined()
  })
})

describe('signing data items', () => {
  test("an EOA's signature verifies", async () => {
    const { signer } = fromEthersWallet(ethers.Wallet.createRandom())
    const result = await arweaveBlobStore.prepare([upload], { dataItemSigner: signer })
    expect(result.ids).toHaveLength(1)
    expect(result.pending).toHaveLength(1)
  })

  test("a smart account's signature (not ECDSA from the owner address) is refused", async () => {
    const admin = ethers.Wallet.createRandom()
    const smartAccountAddress = ethers.Wallet.createRandom().address
    // Like an EIP-1271 smart account: its own address, and its admin signs a wrapped message.
    const smartAccountSigner: SeedSigner = {
      address: smartAccountAddress as `0x${string}`,
      signMessage: async ({ message }) => {
        const bytes = typeof message === 'string' ? ethers.toUtf8Bytes(message) : ethers.getBytes(message.raw as never)
        return (await admin.signMessage(ethers.concat(['0x1901', ethers.keccak256(bytes)]))) as `0x${string}`
      },
    } as SeedSigner
    await expect(arweaveBlobStore.prepare([upload], { dataItemSigner: smartAccountSigner })).rejects.toThrow(
      "can't sign Arweave data items",
    )
  })

  test('with no signer, the error says data items need an EOA key', async () => {
    await expect(arweaveBlobStore.prepare([upload], {})).rejects.toThrow("EOA's key")
  })
})
