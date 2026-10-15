import { afterEach, describe, expect, test } from 'bun:test'
import { ethers } from 'ethers'
import { createSignedDataItem } from '../../../helpers/arweave'
import { InsufficientStorageCreditsError } from '../../../helpers/turbo'
import { uploadToTurbo } from '../helpers/uploadToTurbo'

const turbo = { uploadUrl: 'https://up.test', paymentUrl: 'https://pay.test', paidBy: [] as string[] }
const realFetch = globalThis.fetch
let urls: string[] = []

function mockTurbo(balance: string) {
  urls = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    if (url.endsWith('/v1/info')) return json(200, { freeUploadLimitBytes: 10 })
    if (url.includes('/v1/price/bytes/')) return json(200, { winc: '100' })
    if (url.includes('/v1/account/balance/')) return json(200, { winc: balance })
    if (url.endsWith('/v1/tx/ethereum')) return json(200, { id: 'x' })
    return new Response('no route', { status: 500 })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

async function signedItems(count: number) {
  const wallet = ethers.Wallet.createRandom()
  const signer = new ethers.Wallet(wallet.privateKey)
  const items = await Promise.all(
    Array.from({ length: count }, (_, i) => createSignedDataItem(new TextEncoder().encode(`item ${i}`), signer, [])),
  )
  return { address: wallet.address, items }
}

describe('uploadToTurbo (payment.storage: user)', () => {
  test('uploads every item when the signer can pay', async () => {
    const { items } = await signedItems(2)
    mockTurbo('1000')
    await uploadToTurbo(items, turbo, {} as any)
    expect(urls.filter((u) => u.endsWith('/v1/tx/ethereum'))).toHaveLength(2)
  })

  test('uploads nothing when the signer cannot pay', async () => {
    const { address, items } = await signedItems(2)
    mockTurbo('150')
    const error = await uploadToTurbo(items, turbo, {} as any).catch((e) => e)
    expect(error).toBeInstanceOf(InsufficientStorageCreditsError)
    expect(error.address).toBe(address)
    expect(urls.some((u) => u.endsWith('/v1/tx/ethereum'))).toBe(false)
  })

  test('checks the dataItemSigner address when given', async () => {
    const { items } = await signedItems(1)
    mockTurbo('1000')
    await uploadToTurbo(items, turbo, { dataItemSigner: { address: '0xSigner' } } as any)
    expect(urls.some((u) => u.includes('address=0xSigner'))).toBe(true)
  })

  test('with paidBy, skips the balance check and lets Turbo charge the sharer', async () => {
    const { items } = await signedItems(1)
    mockTurbo('0')
    await uploadToTurbo(items, { ...turbo, paidBy: ['0xApp'] }, {} as any)
    expect(urls.some((u) => u.includes('/balance/'))).toBe(false)
    expect(urls.filter((u) => u.endsWith('/v1/tx/ethereum'))).toHaveLength(1)
  })
})
