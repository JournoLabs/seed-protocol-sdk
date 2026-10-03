import { describe, expect, mock, test } from 'bun:test'
import { isNonceTooLowError, retryNonceTooLow } from './retryNonceTooLow'

describe('retryNonceTooLow', () => {
  test('retries a stale-nonce rejection, then succeeds', async () => {
    const send = mock(async () => 'ok')
    send.mockImplementationOnce(async () => {
      throw new Error('outer', { cause: new Error('nonce too low: next nonce 5, tx nonce 4') })
    })
    await expect(retryNonceTooLow(send, { delayMs: 1 })).resolves.toBe('ok')
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('does not retry other errors', async () => {
    const send = mock(async () => {
      throw new Error('execution reverted')
    })
    await expect(retryNonceTooLow(send, { delayMs: 1 })).rejects.toThrow('execution reverted')
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('gives up after the last attempt', async () => {
    const send = mock(async () => {
      throw Object.assign(new Error('nonce has already been used'), { code: 'NONCE_EXPIRED' })
    })
    await expect(retryNonceTooLow(send, { attempts: 2, delayMs: 1 })).rejects.toThrow('nonce has already been used')
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('recognizes ethers and viem phrasing', () => {
    expect(isNonceTooLowError({ code: 'NONCE_EXPIRED' })).toBe(true)
    expect(isNonceTooLowError({ shortMessage: 'Nonce provided for the transaction is lower than the current nonce' })).toBe(true)
    expect(isNonceTooLowError(new Error('replacement transaction underpriced'))).toBe(false)
  })
})
