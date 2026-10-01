import { afterEach, describe, expect, test } from 'bun:test'
import { setConfigRef } from '../config'
import { getPublishPublicClient, resetPublishPublicClient } from './chainClient'

afterEach(() => {
  setConfigRef(null)
  resetPublishPublicClient()
})

function headerValue(client: ReturnType<typeof getPublishPublicClient>): string | undefined {
  const transport = client.transport as {
    config?: { fetchOptions?: { headers?: Record<string, string> } }
    fetchOptions?: { headers?: Record<string, string> }
  }
  return (
    transport.config?.fetchOptions?.headers?.['x-secret-key'] ??
    transport.fetchOptions?.headers?.['x-secret-key']
  )
}

describe('getPublishPublicClient secret key', () => {
  test('sends x-secret-key only when thirdwebSecretKey is set', () => {
    setConfigRef({
      uploadApiBaseUrl: 'http://127.0.0.1:9',
      rpcUrl: 'https://example.invalid/rpc',
    })
    const plain = getPublishPublicClient()
    expect(headerValue(plain)).toBeUndefined()

    resetPublishPublicClient()
    setConfigRef({
      uploadApiBaseUrl: 'http://127.0.0.1:9',
      rpcUrl: 'https://example.invalid/rpc',
      thirdwebClientId: 'cid',
      thirdwebSecretKey: 'sek-rpc',
    })
    const authed = getPublishPublicClient()
    expect(headerValue(authed)).toBe('sek-rpc')
    expect(authed).not.toBe(plain)
  })
})
