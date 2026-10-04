import { afterEach, describe, expect, mock, test } from 'bun:test'
import { setConfigRef } from '../config'
import { PublishTransactionRevertedError } from '../errors'
import { getPublishPublicClient, readUntil, resetPublishPublicClient, waitForPublishReceipt } from './chainClient'

const HASH = `0x${'12'.repeat(32)}` as const

function stubReceipt(status: 'success' | 'reverted') {
  setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' })
  const client = getPublishPublicClient() as unknown as { waitForTransactionReceipt: unknown }
  client.waitForTransactionReceipt = async () => ({ status, transactionHash: HASH, logs: [] })
}

afterEach(() => {
  setConfigRef(null)
  resetPublishPublicClient()
})

describe('waitForPublishReceipt', () => {
  test('returns a successful receipt', async () => {
    stubReceipt('success')
    await expect(waitForPublishReceipt(HASH)).resolves.toMatchObject({ status: 'success' })
  })

  test('throws PublishTransactionRevertedError for a reverted receipt', async () => {
    stubReceipt('reverted')
    const err = await waitForPublishReceipt(HASH).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PublishTransactionRevertedError)
    expect(err).toMatchObject({ transactionHash: HASH, receipt: { status: 'reverted' } })
  })
})

describe('readUntil', () => {
  test('stops reading once a result is accepted', async () => {
    const read = mock(async () => read.mock.calls.length >= 2)
    await expect(readUntil(read, Boolean, { attempts: 5, intervalMs: 0 })).resolves.toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
  })

  test('returns the last result after the last attempt', async () => {
    const read = mock(async () => false)
    await expect(readUntil(read, Boolean, { attempts: 3, intervalMs: 0 })).resolves.toBe(false)
    expect(read).toHaveBeenCalledTimes(3)
  })
})
