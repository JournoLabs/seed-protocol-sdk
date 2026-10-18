import { afterEach, describe, expect, test } from 'bun:test'
import { ethers } from 'ethers'
import { createSignedDataItem } from './arweave'
import {
  assertTurboCanPay,
  ethereumSignerOfDataItem,
  getTurboBalanceWinc,
  getTurboDataItemStatus,
  InsufficientStorageCreditsError,
  uploadDataItemToTurbo,
} from './turbo'

const endpoints = { uploadUrl: 'https://up.test', paymentUrl: 'https://pay.test' }
const realFetch = globalThis.fetch
type Call = { url: string; init?: RequestInit }
let calls: Call[] = []

/** Routes fetch by URL substring to [status, body]. */
function mockFetch(routes: Record<string, [number, unknown]>) {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return new Response('no route', { status: 500 })
    const [status, body] = routes[key]!
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('getTurboBalanceWinc', () => {
  test('an address Turbo has never seen has 0', async () => {
    mockFetch({ '/v1/account/balance/ethereum': [404, 'User Not Found'] })
    expect(await getTurboBalanceWinc(endpoints, '0xabc')).toBe(0n)
    expect(calls[0]!.url).toBe('https://pay.test/v1/account/balance/ethereum?address=0xabc')
  })
  test('prefers effectiveBalance (own + shared credits)', async () => {
    mockFetch({ '/v1/account/balance/ethereum': [200, { winc: '5', effectiveBalance: '12' }] })
    expect(await getTurboBalanceWinc(endpoints, '0xabc')).toBe(12n)
  })
})

describe('assertTurboCanPay', () => {
  const routes = (balance: string) => ({
    '/v1/info': [200, { freeUploadLimitBytes: 100 }] as [number, unknown],
    '/v1/price/bytes/': [200, { winc: '10' }] as [number, unknown],
    '/v1/account/balance/ethereum': [200, { winc: balance }] as [number, unknown],
  })

  test('items under the free size need no credits', async () => {
    mockFetch(routes('0'))
    await assertTurboCanPay(endpoints, '0xabc', [50, 100])
    expect(calls.some((c) => c.url.includes('/balance'))).toBe(false)
  })
  test('passes when the balance covers the paid items', async () => {
    mockFetch(routes('20'))
    await assertTurboCanPay(endpoints, '0xabc', [50, 500, 600])
  })
  test('throws InsufficientStorageCreditsError with the amounts', async () => {
    mockFetch(routes('15'))
    const error = await assertTurboCanPay(endpoints, '0xabc', [500, 600]).catch((e) => e)
    expect(error).toBeInstanceOf(InsufficientStorageCreditsError)
    expect(error.requiredWinc).toBe(20n)
    expect(error.balanceWinc).toBe(15n)
    expect(error.address).toBe('0xabc')
  })
})

describe('uploadDataItemToTurbo', () => {
  test('POSTs the raw item to /v1/tx/ethereum', async () => {
    mockFetch({ '/v1/tx/ethereum': [200, { id: 'item1', winc: '7' }] })
    const receipt = await uploadDataItemToTurbo(endpoints, new Uint8Array([1, 2, 3]), { signerAddress: '0xabc' })
    expect(receipt.id).toBe('item1')
    expect(calls[0]!.url).toBe('https://up.test/v1/tx/ethereum')
    expect(calls[0]!.init?.method).toBe('POST')
    expect((calls[0]!.init?.headers as Record<string, string>)['x-paid-by']).toBeUndefined()
  })
  test('sends paidBy as x-paid-by', async () => {
    mockFetch({ '/v1/tx/ethereum': [200, { id: 'item1' }] })
    await uploadDataItemToTurbo(endpoints, new Uint8Array([1]), { signerAddress: '0xabc', paidBy: ['0x1', '0x2'] })
    expect((calls[0]!.init?.headers as Record<string, string>)['x-paid-by']).toBe('0x1,0x2')
  })
  test('402 is InsufficientStorageCreditsError', async () => {
    mockFetch({ '/v1/tx/ethereum': [402, { error: 'Insufficient balance' }] })
    const error = await uploadDataItemToTurbo(endpoints, new Uint8Array([1]), { signerAddress: '0xabc' }).catch(
      (e) => e,
    )
    expect(error).toBeInstanceOf(InsufficientStorageCreditsError)
  })
  test('other failures throw with the status', async () => {
    mockFetch({ '/v1/tx/ethereum': [500, 'boom'] })
    await expect(uploadDataItemToTurbo(endpoints, new Uint8Array([1]), { signerAddress: '0xabc' })).rejects.toThrow(
      'HTTP 500',
    )
  })
})

describe('getTurboDataItemStatus', () => {
  test('returns the HTTP status', async () => {
    mockFetch({ '/v1/tx/missing/status': [404, "TX doesn't exist"], '/v1/tx/there/status': [200, { status: 'CONFIRMED' }] })
    expect(await getTurboDataItemStatus(endpoints, 'missing')).toBe(404)
    expect(await getTurboDataItemStatus(endpoints, 'there')).toBe(200)
  })
})

describe('ethereumSignerOfDataItem', () => {
  test('recovers the signing address from a signed data item', async () => {
    const wallet = ethers.Wallet.createRandom()
    const item = await createSignedDataItem(new TextEncoder().encode('hello'), new ethers.Wallet(wallet.privateKey), [])
    expect(ethereumSignerOfDataItem(item.raw)).toBe(wallet.address)
  })
  test('undefined for a non-Ethereum signature type', () => {
    const raw = new Uint8Array(200)
    raw[0] = 1
    expect(ethereumSignerOfDataItem(raw)).toBeUndefined()
  })
})
