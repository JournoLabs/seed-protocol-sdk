import { describe, expect, test } from 'bun:test'
import { ethers } from 'ethers'
import {
  buildPublishAnchorBytes,
  createSignedDataItem,
  verifyDataItem,
} from './arweave'

// Well-known Hardhat test key #0 — local tests only.
const TEST_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

describe('buildPublishAnchorBytes', () => {
  test('returns 32 bytes', () => {
    const a = buildPublishAnchorBytes('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 1_700_000_000_000, 1n)
    expect(a.length).toBe(32)
  })

  test('differs when uniqueness changes', () => {
    const addr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const a = buildPublishAnchorBytes(addr, 1_700_000_000_000, 1n)
    const b = buildPublishAnchorBytes(addr, 1_700_000_000_000, 2n)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})

describe('createSignedDataItem + verifyDataItem', () => {
  test('verifyDataItem succeeds with empty anchor', async () => {
    const wallet = new ethers.Wallet(TEST_PK)
    const data = new TextEncoder().encode('hello')
    const tags = [{ name: 'Content-Type', value: 'text/plain' }]
    const item = await createSignedDataItem(data, wallet, tags)
    expect(await verifyDataItem(item.raw)).toBe(true)
  })

  test('verifyDataItem succeeds with 32-byte anchor', async () => {
    const wallet = new ethers.Wallet(TEST_PK)
    const data = new TextEncoder().encode('hello')
    const tags = [{ name: 'Content-Type', value: 'text/plain' }]
    const rawAnchor = buildPublishAnchorBytes(wallet.address, Date.now(), 42n)
    const item = await createSignedDataItem(data, wallet, tags, rawAnchor)
    expect(await verifyDataItem(item.raw)).toBe(true)
  })

  test('same payload yields different ids when anchor differs', async () => {
    const wallet = new ethers.Wallet(TEST_PK)
    const data = new TextEncoder().encode('same-bytes')
    const tags = [{ name: 'Content-SHA-256', value: 'abc' }]
    const ts = 1_700_000_000_000
    const a1 = buildPublishAnchorBytes(wallet.address, ts, 1n)
    const a2 = buildPublishAnchorBytes(wallet.address, ts, 2n)
    const item1 = await createSignedDataItem(data, wallet, tags, a1)
    const item2 = await createSignedDataItem(data, wallet, tags, a2)
    expect(item1.id).not.toBe(item2.id)
    expect(await verifyDataItem(item1.raw)).toBe(true)
    expect(await verifyDataItem(item2.raw)).toBe(true)
  })
})
