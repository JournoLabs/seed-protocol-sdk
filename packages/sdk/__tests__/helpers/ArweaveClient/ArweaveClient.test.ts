/**
 * Unit tests for BaseArweaveClient
 * 
 * These tests use MockArweaveClient to verify the behavior of the
 * ArweaveClient without making real network requests.
 * 
 * Note: These tests run only in Node.js environment as they use MockArweaveClient.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { invalidateReadGatewayCache } from '@/helpers/ArweaveClient/selectReadGateway'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { MockArweaveClient } from '../../test-utils/MockArweaveClient'

// Skip in browser environment
const isNodeEnv = typeof window === 'undefined'

describe.skipIf(!isNodeEnv)('BaseArweaveClient', () => {
  // Store original platform class
  let originalPlatformClass: typeof BaseArweaveClient | undefined

  beforeEach(() => {
    // Save original platform class
    originalPlatformClass = BaseArweaveClient.PlatformClass

    // Set MockArweaveClient as the platform class
    BaseArweaveClient.setPlatformClass(MockArweaveClient)
    MockArweaveClient.reset()
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
    BaseArweaveClient.resetReadGatewaySelectionStateForTests()
    invalidateReadGatewayCache()
  })

  afterEach(() => {
    // Restore original platform class
    if (originalPlatformClass) {
      BaseArweaveClient.setPlatformClass(originalPlatformClass)
    }
    MockArweaveClient.reset()
  })

  describe('Configuration Methods', () => {
    describe('getHost()', () => {
      it('returns default gateway host', () => {
        const host = BaseArweaveClient.getHost()
        expect(host).toBe(DEFAULT_ARWEAVE_HOST)
      })

      it('returns custom host when configured via setHost()', () => {
        BaseArweaveClient.setHost('custom-gateway.example.com')
        const host = BaseArweaveClient.getHost()
        expect(host).toBe('custom-gateway.example.com')
        
        // Reset for other tests
        BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
      })

      it('parses http:// prefix for local gateways', () => {
        BaseArweaveClient.setHost('http://localhost:1984')
        expect(BaseArweaveClient.getHost()).toBe('localhost:1984')
        expect(BaseArweaveClient.getProtocol()).toBe('http')
        expect(BaseArweaveClient.getBaseUrl()).toBe('http://localhost:1984')
        BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
      })
    })

    describe('getEndpoint()', () => {
      it('returns correct GraphQL endpoint URL', () => {
        const endpoint = BaseArweaveClient.getEndpoint()
        expect(endpoint).toBe(`https://${DEFAULT_ARWEAVE_HOST}/graphql`)
      })

      it('uses configured host in endpoint URL', () => {
        BaseArweaveClient.setHost('custom-gateway.example.com')
        const endpoint = BaseArweaveClient.getEndpoint()
        expect(endpoint).toBe('https://custom-gateway.example.com/graphql')
        
        // Reset for other tests
        BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
      })
    })

    describe('getRawUrl()', () => {
      it('constructs correct URL for transaction ID', () => {
        const url = BaseArweaveClient.getRawUrl('abc123')
        expect(url).toBe(`https://${DEFAULT_ARWEAVE_HOST}/raw/abc123`)
      })

      it('uses configured host in URL', () => {
        BaseArweaveClient.setHost('custom-gateway.example.com')
        const url = BaseArweaveClient.getRawUrl('abc123')
        expect(url).toBe('https://custom-gateway.example.com/raw/abc123')
        
        // Reset for other tests
        BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
      })

      it('handles long transaction IDs', () => {
        const txId = 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U'
        const url = BaseArweaveClient.getRawUrl(txId)
        expect(url).toBe(`https://${DEFAULT_ARWEAVE_HOST}/raw/${txId}`)
      })
    })

    describe('getStatusUrl()', () => {
      it('constructs gateway presence URL for transaction ID', () => {
        const url = BaseArweaveClient.getStatusUrl('abc123')
        expect(url).toBe(`https://${DEFAULT_ARWEAVE_HOST}/abc123`)
      })
    })
  })

  describe('Transaction Operations', () => {
    describe('getTransactionStatus()', () => {
      it('returns status for valid transaction', async () => {
        MockArweaveClient.addMockTransaction('tx123', new Uint8Array([1, 2, 3]))
        
        const status = await BaseArweaveClient.getTransactionStatus('tx123')
        
        expect(status.status).toBe(200)
        expect(status.confirmed).not.toBeNull()
        expect(status.confirmed?.block_height).toBe(1000000)
        expect(status.confirmed?.number_of_confirmations).toBe(100)
      })

      it('returns 404 for non-existent transaction', async () => {
        const status = await BaseArweaveClient.getTransactionStatus('nonexistent')
        
        expect(status.status).toBe(404)
        expect(status.confirmed).toBeNull()
      })

      it('returns custom status when configured', async () => {
        MockArweaveClient.addMockTransaction('tx500', new Uint8Array([1, 2, 3]), {
          status: 500,
          confirmed: null,
        })
        
        const status = await BaseArweaveClient.getTransactionStatus('tx500')
        
        expect(status.status).toBe(500)
        expect(status.confirmed).toBeNull()
      })
    })

    describe('getTransactionData()', () => {
      it('fetches binary data as Uint8Array', async () => {
        const testData = new Uint8Array([1, 2, 3, 4, 5])
        MockArweaveClient.addMockTransaction('txBinary', testData)
        
        const data = await BaseArweaveClient.getTransactionData('txBinary')
        
        expect(data).toBeInstanceOf(Uint8Array)
        expect(data).toEqual(testData)
      })

      it('fetches string data when string option is true', async () => {
        const testContent = 'Hello, Arweave!'
        MockArweaveClient.addMockTransaction('txString', new TextEncoder().encode(testContent))
        
        const data = await BaseArweaveClient.getTransactionData('txString', { string: true })
        
        expect(typeof data).toBe('string')
        expect(data).toBe(testContent)
      })

      it('throws error for missing transaction', async () => {
        await expect(
          BaseArweaveClient.getTransactionData('nonexistent')
        ).rejects.toThrow('Transaction nonexistent not found')
      })

      it('handles JSON content', async () => {
        const jsonContent = JSON.stringify({ foo: 'bar', count: 42 })
        MockArweaveClient.addMockTransaction('txJson', new TextEncoder().encode(jsonContent))
        
        const data = await BaseArweaveClient.getTransactionData('txJson', { string: true })
        
        expect(JSON.parse(data as string)).toEqual({ foo: 'bar', count: 42 })
      })

      it('handles HTML content', async () => {
        const htmlContent = '<html><body><h1>Hello</h1></body></html>'
        MockArweaveClient.addMockTransaction('txHtml', new TextEncoder().encode(htmlContent))
        
        const data = await BaseArweaveClient.getTransactionData('txHtml', { string: true })
        
        expect(data).toBe(htmlContent)
      })
    })

    describe('getTransactionTags()', () => {
      it('returns tags for transaction with tags', async () => {
        MockArweaveClient.addMockTransaction('txWithTags', new Uint8Array([1, 2, 3]), {
          tags: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'App-Name', value: 'TestApp' },
          ],
        })
        
        const tags = await BaseArweaveClient.getTransactionTags('txWithTags')
        
        expect(tags).toHaveLength(2)
        expect(tags[0]).toEqual({ name: 'Content-Type', value: 'application/json' })
        expect(tags[1]).toEqual({ name: 'App-Name', value: 'TestApp' })
      })

      it('returns empty array for transaction without tags', async () => {
        MockArweaveClient.addMockTransaction('txNoTags', new Uint8Array([1, 2, 3]))
        
        const tags = await BaseArweaveClient.getTransactionTags('txNoTags')
        
        expect(tags).toEqual([])
      })

      it('returns empty array for non-existent transaction', async () => {
        const tags = await BaseArweaveClient.getTransactionTags('nonexistent')
        
        expect(tags).toEqual([])
      })
    })

    describe('createTransaction()', () => {
      it('creates transaction with string data', async () => {
        const data = 'Hello, Arweave!'
        
        const tx = await BaseArweaveClient.createTransaction(data)
        
        expect(tx.id).toBeDefined()
        expect(tx.id).toMatch(/^mock-tx-\d+$/)
        
        // Verify the transaction was recorded
        const createdTx = MockArweaveClient.getLastCreatedTransaction()
        expect(createdTx).toBeDefined()
        expect(new TextDecoder().decode(createdTx!.data)).toBe(data)
      })

      it('creates transaction with Uint8Array data', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5])
        
        const tx = await BaseArweaveClient.createTransaction(data)
        
        expect(tx.id).toBeDefined()
        
        const createdTx = MockArweaveClient.getLastCreatedTransaction()
        expect(createdTx!.data).toEqual(data)
      })

      it('adds tags when provided', async () => {
        const tx = await BaseArweaveClient.createTransaction('test data', {
          tags: [
            { name: 'Content-SHA-256', value: 'abc123hash' },
            { name: 'App-Name', value: 'SeedProtocol' },
          ],
        })
        
        const createdTx = MockArweaveClient.getLastCreatedTransaction()
        expect(createdTx!.tags).toHaveLength(2)
        expect(createdTx!.tags[0]).toEqual({ name: 'Content-SHA-256', value: 'abc123hash' })
      })

      it('returns transaction with addTag method', async () => {
        const tx = await BaseArweaveClient.createTransaction('test data')
        
        expect(typeof tx.addTag).toBe('function')
        
        // Add a tag via the returned method
        tx.addTag('Custom-Tag', 'custom-value')
        
        const createdTx = MockArweaveClient.getLastCreatedTransaction()
        expect(createdTx!.tags).toContainEqual({ name: 'Custom-Tag', value: 'custom-value' })
      })
    })
  })

  describe('Bulk Operations', () => {
    describe('downloadFiles()', () => {
      it('downloads multiple files successfully', async () => {
        MockArweaveClient.addMockTransaction('tx1', new TextEncoder().encode('content1'))
        MockArweaveClient.addMockTransaction('tx2', new TextEncoder().encode('content2'))
        MockArweaveClient.addMockTransaction('tx3', new TextEncoder().encode('content3'))
        
        const results = await BaseArweaveClient.downloadFiles({
          transactionIds: ['tx1', 'tx2', 'tx3'],
        })
        
        expect(results).toHaveLength(3)
        expect(results.every(r => r.success)).toBe(true)
        expect(new TextDecoder().decode(results[0].data as Uint8Array)).toBe('content1')
      })

      it('skips excluded transactions', async () => {
        MockArweaveClient.addMockTransaction('tx1', new TextEncoder().encode('content1'))
        MockArweaveClient.addMockTransaction('tx2', new TextEncoder().encode('content2'))
        
        const results = await BaseArweaveClient.downloadFiles({
          transactionIds: ['tx1', 'tx2'],
          excludedTransactions: new Set(['tx1']),
        })
        
        expect(results).toHaveLength(1)
        expect(results[0].transactionId).toBe('tx2')
      })

      it('returns failure for non-existent transactions', async () => {
        MockArweaveClient.addMockTransaction('tx1', new TextEncoder().encode('content1'))
        
        const results = await BaseArweaveClient.downloadFiles({
          transactionIds: ['tx1', 'nonexistent'],
        })
        
        expect(results).toHaveLength(2)
        expect(results[0].success).toBe(true)
        expect(results[1].success).toBe(false)
        expect(results[1].error).toContain('not found')
      })

      it('returns failure for transactions with error status', async () => {
        MockArweaveClient.addMockTransaction('txError', new Uint8Array([1, 2, 3]), {
          status: 500,
          confirmed: null,
        })
        
        const results = await BaseArweaveClient.downloadFiles({
          transactionIds: ['txError'],
        })
        
        expect(results).toHaveLength(1)
        expect(results[0].success).toBe(false)
        expect(results[0].error).toContain('500')
      })
    })
  })
})
