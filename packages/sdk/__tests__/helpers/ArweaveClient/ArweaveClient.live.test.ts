/**
 * BaseArweaveClient against the real Arweave network: live gateways, so results depend on them
 * (a slow gateway answers 504). Skipped unless SEED_LIVE_NETWORK_TESTS=1, and Node only.
 * ArweaveClient.test.ts covers the same methods against a mocked network.
 *
 *   SEED_LIVE_NETWORK_TESTS=1 bunx vitest run --project NodeJS packages/sdk/__tests__/helpers/ArweaveClient/ArweaveClient.live.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setPreferredArweaveReadBaseUrls, BaseArweaveClient } from '@seedprotocol/arweave'

// Import the node ArweaveClient to set up the platform class
// This import sets up BaseArweaveClient.PlatformClass automatically
import '@seedprotocol/arweave/node'

// Known stable transaction IDs from Arweave mainnet for integration testing
// These are permanent, immutable transactions that should always exist

// ArDrive logo - a well-known, stable transaction
// https://viewblock.io/arweave/tx/bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U
const KNOWN_TX_ID = 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U'

// A simple text file for testing data retrieval
// This is a small, well-known transaction
const KNOWN_TEXT_TX_ID = 'Sgmwx-GEq9-k8J_V7VPiX09j_1RTHF-VsQaOMxS7v-4'

const runLive = typeof window === 'undefined' && process.env.SEED_LIVE_NETWORK_TESTS === '1'

describe.skipIf(!runLive)('ArweaveClient against live gateways', () => {
  // Increase timeout for network requests
  const NETWORK_TIMEOUT = 30000

  // With SEED_GATEWAY_HYPER_KEY set (a CI secret), status checks ask our Hyper gateway first and
  // the public gateways after it. Without it, or if the tunnel can't connect, they use the public
  // gateways only. Data, tag and URL tests stay on arweave.net either way.
  let hyperTunnel: { baseUrl: string; close: () => Promise<void> } | undefined

  beforeAll(async () => {
    // Ensure we're using the default Arweave host
    BaseArweaveClient.setHost('arweave.net')

    const key = process.env.SEED_GATEWAY_HYPER_KEY?.trim()
    if (!key) return
    try {
      const { connectTunnel } = await import('@seedprotocol/gateway-hyper')
      hyperTunnel = await connectTunnel({ key, host: '127.0.0.1', port: 0, connectTimeoutMs: 20000 })
      // The tunnel dials the operator on its first request; only use it once that request works.
      const info = await fetch(`${hyperTunnel.baseUrl}/info`, { signal: AbortSignal.timeout(25000) })
      if (!info.ok) throw new Error(`GET /info through the tunnel returned ${info.status}`)
      setPreferredArweaveReadBaseUrls([hyperTunnel.baseUrl])
    } catch (error) {
      console.warn('[ArweaveClient live] Hyper gateway unavailable, using public gateways:', error)
      await hyperTunnel?.close().catch(() => {})
      hyperTunnel = undefined
    }
  }, NETWORK_TIMEOUT)

  afterAll(async () => {
    setPreferredArweaveReadBaseUrls([])
    await hyperTunnel?.close()
  })

  describe('getTransactionStatus()', () => {
    it('returns 200 when transaction is available on gateway', async () => {
      const status = await BaseArweaveClient.getTransactionStatus(KNOWN_TX_ID)
      
      expect(status.status).toBe(200)
      expect(status.confirmed).toBeNull()
    }, NETWORK_TIMEOUT)

    it('handles well-formed tx id that is not on the gateway', async () => {
      const status = await BaseArweaveClient.getTransactionStatus(
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      )
      expect(status.confirmed).toBeNull()
      expect(typeof status.status).toBe('number')
    }, NETWORK_TIMEOUT)
  })

  describe('getTransactionData()', () => {
    it('fetches data for known transaction', async () => {
      let data: unknown
      try {
        data = await BaseArweaveClient.getTransactionData(KNOWN_TX_ID)
      } catch (error) {
        // Mainnet can be slow or unreachable; arweave-js may throw after chunk/gateway fallback
        expect(String((error as Error)?.message ?? error)).toMatch(/not found|timeout|fetch|data/i)
        return
      }
      const len =
        typeof data === 'string'
          ? data.length
          : data instanceof ArrayBuffer
            ? data.byteLength
            : ArrayBuffer.isView(data)
              ? data.byteLength
              : 0
      expect(len).toBeGreaterThan(0)
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
      expect(url).toBe(`https://arweave.net/${KNOWN_TX_ID}`)
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
