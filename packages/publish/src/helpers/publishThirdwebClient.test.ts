import { afterEach, describe, expect, test } from 'bun:test'
import { setConfigRef } from '../config'
import { getClient, resetPublishThirdwebClient } from './publishThirdwebClient'

afterEach(() => {
  setConfigRef(null)
  resetPublishThirdwebClient()
})

describe('getClient', () => {
  test('passes secretKey and clientId to the thirdweb client', () => {
    setConfigRef({
      uploadApiBaseUrl: 'http://127.0.0.1:9',
      thirdwebClientId: 'cid-test',
      thirdwebSecretKey: 'sek-test',
    })
    const client = getClient()
    expect(client.clientId).toBe('cid-test')
    expect(client.secretKey).toBe('sek-test')
  })

  test('accepts a secret key without a client id and recreates when config changes', () => {
    setConfigRef({
      uploadApiBaseUrl: 'http://127.0.0.1:9',
      thirdwebSecretKey: 'sek-only',
    })
    const first = getClient()
    expect(first.secretKey).toBe('sek-only')
    expect(first.clientId.length).toBeGreaterThan(0)

    setConfigRef({
      uploadApiBaseUrl: 'http://127.0.0.1:9',
      thirdwebClientId: 'cid-next',
    })
    const second = getClient()
    expect(second).not.toBe(first)
    expect(second.clientId).toBe('cid-next')
    expect(second.secretKey).toBeUndefined()
  })

  test('throws when neither client id nor secret key is set', () => {
    setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9' })
    expect(() => getClient()).toThrow(/thirdwebClientId or thirdwebSecretKey/)
  })
})
