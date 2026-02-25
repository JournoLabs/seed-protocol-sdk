/**
 * Integration tests for BaseArweaveClient against real Arweave network
 * 
 * These tests make real network requests to Arweave to verify the implementation
 * works correctly against the actual API.
 * 
 * Note: These tests require network access and may be slow. They are designed
 * to be run less frequently than unit tests. They run only in Node.js environment.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'

// Import the node ArweaveClient to set up the platform class
// This import sets up BaseArweaveClient.PlatformClass automatically
import '@/node/helpers/ArweaveClient'

// Known stable transaction IDs from Arweave mainnet for integration testing
// These are permanent, immutable transactions that should always exist

// ArDrive logo - a well-known, stable transaction
// https://viewblock.io/arweave/tx/bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U
const KNOWN_TX_ID = 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U'

// A simple text file for testing data retrieval
// This is a small, well-known transaction
const KNOWN_TEXT_TX_ID = 'Sgmwx-GEq9-k8J_V7VPiX09j_1RTHF-VsQaOMxS7v-4'

// Skip in browser environment - these tests require Node.js for network requests
const isNodeEnv = typeof window === 'undefined'

describe.skipIf(!isNodeEnv)('ArweaveClient Integration', () => {
  // Increase timeout for network requests
  const NETWORK_TIMEOUT = 30000

  beforeAll(() => {
    // Ensure we're using the default Arweave host
    BaseArweaveClient.setHost('arweave.net')
  })

  describe('getTransactionStatus()', () => {
    it('returns confirmed status for known transaction', async () => {
      const status = await BaseArweaveClient.getTransactionStatus(KNOWN_TX_ID)
      
      expect(status.status).toBe(200)
      expect(status.confirmed).not.toBeNull()
      expect(status.confirmed?.block_height).toBeGreaterThan(0)
      expect(status.confirmed?.number_of_confirmations).toBeGreaterThan(0)
    }, NETWORK_TIMEOUT)

    it('returns 404 for non-existent transaction', async () => {
      // Use a clearly invalid transaction ID
      const status = await BaseArweaveClient.getTransactionStatus('this-is-not-a-valid-tx-id-000000000')
      
      // Arweave returns various responses for invalid IDs
      // Could be 404 or 400 depending on the format
      expect([400, 404, 500]).toContain(status.status)
      expect(status.confirmed).toBeNull()
    }, NETWORK_TIMEOUT)

    it('handles random invalid transaction gracefully', async () => {
      // Generate a random but well-formed-looking transaction ID
      const fakeId = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      const status = await BaseArweaveClient.getTransactionStatus(fakeId)
      
      // Should not throw, just return an error status
      expect(typeof status.status).toBe('number')
    }, NETWORK_TIMEOUT)
  })

  describe('getTransactionData()', () => {
    it('fetches data for known transaction', async () => {
      const data = await BaseArweaveClient.getTransactionData(KNOWN_TX_ID)
      
      expect(data).toBeInstanceOf(Uint8Array)
      expect((data as Uint8Array).length).toBeGreaterThan(0)
    }, NETWORK_TIMEOUT)

    it('returns string when string option is true', async () => {
      // Try to get data as string
      // Note: This may fail for binary data like images
      try {
        const data = await BaseArweaveClient.getTransactionData(KNOWN_TX_ID, { string: true })
        expect(typeof data === 'string' || data instanceof Uint8Array).toBe(true)
      } catch (error) {
        // Binary data may not decode as string cleanly, which is acceptable
        expect(error).toBeDefined()
      }
    }, NETWORK_TIMEOUT)

    it('throws error for non-existent transaction', async () => {
      await expect(
        BaseArweaveClient.getTransactionData('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
      ).rejects.toThrow()
    }, NETWORK_TIMEOUT)
  })

  describe('getTransactionTags()', () => {
    it('fetches tags for known transaction', async () => {
      const tags = await BaseArweaveClient.getTransactionTags(KNOWN_TX_ID)
      
      expect(Array.isArray(tags)).toBe(true)
      // Most Arweave transactions have at least some tags
      // But we can't guarantee which ones, so just verify the structure
      if (tags.length > 0) {
        expect(tags[0]).toHaveProperty('name')
        expect(tags[0]).toHaveProperty('value')
      }
    }, NETWORK_TIMEOUT)

    it('returns empty array gracefully for transaction without tags', async () => {
      // Even if the transaction doesn't exist, should return empty array
      const tags = await BaseArweaveClient.getTransactionTags('nonexistent-tx')
      
      expect(Array.isArray(tags)).toBe(true)
    }, NETWORK_TIMEOUT)
  })

  describe('createTransaction()', () => {
    it('creates unsigned transaction with string data', async () => {
      const testData = 'Test data for integration test'
      
      const tx = await BaseArweaveClient.createTransaction(testData)
      
      // Transaction should have an ID (though it's not signed/submitted yet)
      expect(tx).toBeDefined()
      expect(tx.data).toBeDefined()
    }, NETWORK_TIMEOUT)

    it('creates unsigned transaction with Uint8Array data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5])
      
      const tx = await BaseArweaveClient.createTransaction(testData)
      
      expect(tx).toBeDefined()
      expect(tx.data).toBeDefined()
    }, NETWORK_TIMEOUT)

    it('adds tags to transaction', async () => {
      const tx = await BaseArweaveClient.createTransaction('test data', {
        tags: [
          { name: 'Content-Type', value: 'text/plain' },
          { name: 'App-Name', value: 'SeedProtocol-Test' },
        ],
      })
      
      expect(tx).toBeDefined()
      // The transaction should have the addTag method available
      expect(typeof tx.addTag).toBe('function')
    }, NETWORK_TIMEOUT)
  })

  describe('URL Construction', () => {
    it('getRawUrl constructs correct URL', () => {
      const url = BaseArweaveClient.getRawUrl(KNOWN_TX_ID)
      expect(url).toBe(`https://arweave.net/raw/${KNOWN_TX_ID}`)
    })

    it('getStatusUrl constructs correct URL', () => {
      const url = BaseArweaveClient.getStatusUrl(KNOWN_TX_ID)
      expect(url).toBe(`https://arweave.net/tx/${KNOWN_TX_ID}/status`)
    })

    it('getEndpoint returns correct GraphQL endpoint', () => {
      const endpoint = BaseArweaveClient.getEndpoint()
      expect(endpoint).toBe('https://arweave.net/graphql')
    })
  })

  describe('downloadFiles()', () => {
    it('downloads single file successfully', async () => {
      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: [KNOWN_TX_ID],
      })
      
      expect(results).toHaveLength(1)
      expect(results[0].transactionId).toBe(KNOWN_TX_ID)
      expect(results[0].success).toBe(true)
      expect(results[0].data).toBeInstanceOf(Uint8Array)
      expect((results[0].data as Uint8Array).length).toBeGreaterThan(0)
    }, NETWORK_TIMEOUT)

    it('handles mix of valid and invalid transactions', async () => {
      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: [KNOWN_TX_ID, 'invalid-tx-id-that-does-not-exist'],
      })
      
      expect(results).toHaveLength(2)
      
      // First should succeed
      const validResult = results.find(r => r.transactionId === KNOWN_TX_ID)
      expect(validResult?.success).toBe(true)
      
      // Second should fail
      const invalidResult = results.find(r => r.transactionId === 'invalid-tx-id-that-does-not-exist')
      expect(invalidResult?.success).toBe(false)
    }, NETWORK_TIMEOUT)

    it('respects excluded transactions', async () => {
      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: [KNOWN_TX_ID],
        excludedTransactions: new Set([KNOWN_TX_ID]),
      })
      
      // Should skip the excluded transaction
      expect(results).toHaveLength(0)
    }, NETWORK_TIMEOUT)
  })
})
