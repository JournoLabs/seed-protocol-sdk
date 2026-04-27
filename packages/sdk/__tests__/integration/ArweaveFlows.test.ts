/**
 * Integration tests for Arweave consumer flows
 * 
 * These tests verify that the various parts of the SDK that use Arweave
 * work correctly with the consolidated ArweaveClient.
 * 
 * Note: These tests run only in Node.js environment as they use MockArweaveClient
 * which requires Node.js-specific imports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { invalidateReadGatewayCache } from '@/helpers/ArweaveClient/selectReadGateway'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { MockArweaveClient } from '../test-utils/MockArweaveClient'
import { getArweaveUrlForTransaction } from '@/helpers'

// Skip in browser environment
const isNodeEnv = typeof window === 'undefined'

describe.skipIf(!isNodeEnv)('Arweave Consumer Flows', () => {
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

  describe('URL Generation Flow', () => {
    it('generates correct Arweave URLs via BaseArweaveClient.getRawUrl()', () => {
      const url = BaseArweaveClient.getRawUrl('abc123')
      expect(url).toBe(`https://${DEFAULT_ARWEAVE_HOST}/raw/abc123`)
    })

    it('deprecated getArweaveUrlForTransaction() delegates to BaseArweaveClient', () => {
      // The deprecated function should still work and produce the same result
      const url = getArweaveUrlForTransaction('abc123')
      const directUrl = BaseArweaveClient.getRawUrl('abc123')
      expect(url).toBe(directUrl)
    })

    it('respects custom host configuration', () => {
      BaseArweaveClient.setHost('custom-gateway.example.com')
      
      const url = BaseArweaveClient.getRawUrl('abc123')
      expect(url).toBe('https://custom-gateway.example.com/raw/abc123')
      
      // Also check the deprecated function
      const deprecatedUrl = getArweaveUrlForTransaction('abc123')
      expect(deprecatedUrl).toBe('https://custom-gateway.example.com/raw/abc123')
      
      // Reset
      BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
    })
  })

  describe('Transaction Status Check Flow', () => {
    it('correctly identifies confirmed transactions', async () => {
      MockArweaveClient.addMockTransaction('confirmed-tx', new Uint8Array([1, 2, 3]), {
        status: 200,
        confirmed: {
          block_height: 1000000,
          block_indep_hash: 'test-hash',
          number_of_confirmations: 100,
        },
      })

      const status = await BaseArweaveClient.getTransactionStatus('confirmed-tx')
      
      expect(status.status).toBe(200)
      expect(status.confirmed).not.toBeNull()
      expect(status.confirmed?.number_of_confirmations).toBeGreaterThan(0)
    })

    it('correctly identifies pending transactions', async () => {
      MockArweaveClient.addMockTransaction('pending-tx', new Uint8Array([1, 2, 3]), {
        status: 202, // Accepted but not yet confirmed
        confirmed: null,
      })

      const status = await BaseArweaveClient.getTransactionStatus('pending-tx')
      
      expect(status.status).toBe(202)
      expect(status.confirmed).toBeNull()
    })

    it('correctly handles not found transactions', async () => {
      const status = await BaseArweaveClient.getTransactionStatus('nonexistent-tx')
      
      expect(status.status).toBe(404)
      expect(status.confirmed).toBeNull()
    })
  })

  describe('Data Retrieval Flow', () => {
    it('retrieves binary data correctly', async () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]) // PNG header
      MockArweaveClient.addMockTransaction('binary-tx', binaryData)

      const data = await BaseArweaveClient.getTransactionData('binary-tx')
      
      expect(data).toEqual(binaryData)
    })

    it('retrieves text data as string', async () => {
      const textContent = 'Hello, World!'
      MockArweaveClient.addMockTransaction('text-tx', new TextEncoder().encode(textContent))

      const data = await BaseArweaveClient.getTransactionData('text-tx', { string: true })
      
      expect(data).toBe(textContent)
    })

    it('retrieves JSON data correctly', async () => {
      const jsonData = { name: 'Test', value: 42 }
      MockArweaveClient.addMockTransaction('json-tx', new TextEncoder().encode(JSON.stringify(jsonData)))

      const data = await BaseArweaveClient.getTransactionData('json-tx', { string: true })
      const parsed = JSON.parse(data as string)
      
      expect(parsed).toEqual(jsonData)
    })

    it('retrieves HTML data correctly', async () => {
      const htmlContent = '<html><body><h1>Test</h1></body></html>'
      MockArweaveClient.addMockTransaction('html-tx', new TextEncoder().encode(htmlContent))

      const data = await BaseArweaveClient.getTransactionData('html-tx', { string: true })
      
      expect(data).toBe(htmlContent)
    })
  })

  describe('Transaction Creation Flow', () => {
    it('creates transaction with content hash tag', async () => {
      const contentHash = 'sha256-abc123def456'
      
      const tx = await BaseArweaveClient.createTransaction('test content', {
        tags: [{ name: 'Content-SHA-256', value: contentHash }],
      })

      const createdTx = MockArweaveClient.getLastCreatedTransaction()
      
      expect(createdTx).toBeDefined()
      expect(createdTx!.tags).toContainEqual({
        name: 'Content-SHA-256',
        value: contentHash,
      })
    })

    it('creates transaction with multiple tags', async () => {
      const tx = await BaseArweaveClient.createTransaction('test content', {
        tags: [
          { name: 'Content-Type', value: 'text/html' },
          { name: 'App-Name', value: 'SeedProtocol' },
          { name: 'App-Version', value: '1.0.0' },
        ],
      })

      const createdTx = MockArweaveClient.getLastCreatedTransaction()
      
      expect(createdTx!.tags).toHaveLength(3)
    })

    it('tracks all created transactions', async () => {
      await BaseArweaveClient.createTransaction('content 1')
      await BaseArweaveClient.createTransaction('content 2')
      await BaseArweaveClient.createTransaction('content 3')

      const allCreated = MockArweaveClient.getCreatedTransactions()
      
      expect(allCreated).toHaveLength(3)
    })

    it('prepareArweaveTransaction merges additional tags after content tags', async () => {
      const { prepareArweaveTransaction } = await import('@/db/read/getPublishUploads')
      await prepareArweaveTransaction('data', 'abc', 'text/plain', [
        { name: 'App-Name', value: 'SeedProtocol' },
      ])
      const created = MockArweaveClient.getLastCreatedTransaction()
      expect(created?.tags).toEqual([
        { name: 'Content-SHA-256', value: 'abc' },
        { name: 'Content-Type', value: 'text/plain' },
        { name: 'App-Name', value: 'SeedProtocol' },
      ])
    })
  })

  describe('Tag Retrieval Flow', () => {
    it('retrieves Content-SHA-256 tag for metadata matching', async () => {
      MockArweaveClient.addMockTransaction('tx-with-hash', new Uint8Array([1, 2, 3]), {
        tags: [
          { name: 'Content-SHA-256', value: 'expected-hash-value' },
          { name: 'Content-Type', value: 'application/octet-stream' },
        ],
      })

      const tags = await BaseArweaveClient.getTransactionTags('tx-with-hash')
      const hashTag = tags.find(t => t.name === 'Content-SHA-256')
      
      expect(hashTag).toBeDefined()
      expect(hashTag!.value).toBe('expected-hash-value')
    })
  })

  describe('Bulk Download Flow', () => {
    it('downloads multiple files in batch', async () => {
      MockArweaveClient.addMockTransaction('img1', new Uint8Array([1, 2, 3]))
      MockArweaveClient.addMockTransaction('img2', new Uint8Array([4, 5, 6]))
      MockArweaveClient.addMockTransaction('img3', new Uint8Array([7, 8, 9]))

      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: ['img1', 'img2', 'img3'],
      })

      expect(results).toHaveLength(3)
      expect(results.every(r => r.success)).toBe(true)
    })

    it('excludes specified transactions from download', async () => {
      MockArweaveClient.addMockTransaction('keep1', new Uint8Array([1]))
      MockArweaveClient.addMockTransaction('exclude1', new Uint8Array([2]))
      MockArweaveClient.addMockTransaction('keep2', new Uint8Array([3]))

      const excludedSet = new Set(['exclude1'])
      
      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: ['keep1', 'exclude1', 'keep2'],
        excludedTransactions: excludedSet,
      })

      expect(results).toHaveLength(2)
      expect(results.map(r => r.transactionId)).toEqual(['keep1', 'keep2'])
    })

    it('reports failures for unavailable transactions', async () => {
      MockArweaveClient.addMockTransaction('available', new Uint8Array([1, 2, 3]))
      // 'unavailable' is not added

      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: ['available', 'unavailable'],
      })

      expect(results).toHaveLength(2)
      
      const availableResult = results.find(r => r.transactionId === 'available')
      expect(availableResult!.success).toBe(true)
      
      const unavailableResult = results.find(r => r.transactionId === 'unavailable')
      expect(unavailableResult!.success).toBe(false)
      expect(unavailableResult!.error).toBeDefined()
    })

    it('handles transactions with error status', async () => {
      MockArweaveClient.addMockTransaction('error-tx', new Uint8Array([1, 2, 3]), {
        status: 500,
        confirmed: null,
      })

      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: ['error-tx'],
      })

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(false)
      expect(results[0].error).toContain('500')
    })
  })

  describe('Mock Reset Behavior', () => {
    it('reset clears all mock data', async () => {
      MockArweaveClient.addMockTransaction('tx1', new Uint8Array([1]))
      MockArweaveClient.setMockHost('custom.host')
      await BaseArweaveClient.createTransaction('test')

      MockArweaveClient.reset()

      // Transactions should be cleared
      const status = await BaseArweaveClient.getTransactionStatus('tx1')
      expect(status.status).toBe(404)

      // Created transactions should be cleared
      expect(MockArweaveClient.getCreatedTransactions()).toHaveLength(0)
    })
  })
})
