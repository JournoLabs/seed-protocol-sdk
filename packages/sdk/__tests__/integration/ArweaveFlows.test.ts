/**
 * The Arweave flows the SDK's consumers depend on, with the real Node client against a local
 * Arweave node (arlocal). ArweaveClient.arlocal.test.ts covers each client method; these tests
 * cover what consumers do with the results.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { BaseArweaveClient, invalidateReadGatewayCache } from '@seedprotocol/arweave'
import '@seedprotocol/arweave/node'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { buildArweaveContentTags } from '@/helpers/arweaveContentTags'
import { pinArweaveClientTo, startLocalArweave, type LocalArweave } from '../test-utils/arlocal'

const isNodeEnv = typeof window === 'undefined'
const MISSING_TX_ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

const decodeTag = (value: string) => new TextDecoder().decode(Buffer.from(value, 'base64url'))

describe.skipIf(!isNodeEnv)('Arweave Consumer Flows', () => {
  describe('URL Generation Flow', () => {
    beforeEach(() => {
      BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
      BaseArweaveClient.resetReadGatewaySelectionStateForTests()
      invalidateReadGatewayCache()
    })

    it('generates correct Arweave URLs via BaseArweaveClient.getRawUrl()', () => {
      expect(BaseArweaveClient.getRawUrl('abc123')).toBe(`https://${DEFAULT_ARWEAVE_HOST}/raw/abc123`)
    })

    it('respects custom host configuration', () => {
      BaseArweaveClient.setHost('custom-gateway.example.com')
      expect(BaseArweaveClient.getRawUrl('abc123')).toBe('https://custom-gateway.example.com/raw/abc123')
      BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
    })
  })

  describe('against a local Arweave node', () => {
    let node: LocalArweave
    let unpin: () => void

    beforeAll(async () => {
      node = await startLocalArweave()
      unpin = pinArweaveClientTo(node)
    }, 60000)

    afterAll(async () => {
      unpin?.()
      await node?.stop()
    })

    describe('Transaction Status Check Flow', () => {
      it('reports a mined transaction as present', async () => {
        const id = await node.postTransaction('mined')
        expect(await BaseArweaveClient.getTransactionStatus(id)).toEqual({ status: 200, confirmed: null })
      })

      it('reports a posted transaction before it is mined', async () => {
        const id = await node.postTransaction('pending', [], { mine: false })
        expect(await BaseArweaveClient.getTransactionStatus(id)).toEqual({ status: 200, confirmed: null })
      })

      it('reports a transaction the gateway lacks as 404', async () => {
        expect(await BaseArweaveClient.getTransactionStatus(MISSING_TX_ID)).toEqual({ status: 404, confirmed: null })
      })
    })

    describe('Data Retrieval Flow', () => {
      it('retrieves JSON data correctly', async () => {
        const json = { name: 'Test', value: 42 }
        const id = await node.postTransaction(JSON.stringify(json), [{ name: 'Content-Type', value: 'application/json' }])
        const data = await BaseArweaveClient.getTransactionData(id, { string: true })
        expect(JSON.parse(data as string)).toEqual(json)
      })

      it('retrieves HTML data correctly', async () => {
        const html = '<html><body><h1>Test</h1></body></html>'
        const id = await node.postTransaction(html, [{ name: 'Content-Type', value: 'text/html' }])
        expect(await BaseArweaveClient.getTransactionData(id, { string: true })).toBe(html)
      })
    })

    describe('Transaction Creation Flow', () => {
      it('creates a transaction carrying the content tags in order', async () => {
        const tags = buildArweaveContentTags('sha256-abc123def456', 'text/html', [
          { name: 'App-Name', value: 'SeedProtocol' },
        ])
        const tx = await BaseArweaveClient.createTransaction('test content', { tags })
        expect(tx.tags.map((t: { name: string; value: string }) => [decodeTag(t.name), decodeTag(t.value)])).toEqual([
          ['Content-SHA-256', 'sha256-abc123def456'],
          ['Content-Type', 'text/html'],
          ['App-Name', 'SeedProtocol'],
        ])
      })

      it('buildArweaveContentTags puts additional tags after content tags', () => {
        expect(buildArweaveContentTags('abc', 'text/plain', [{ name: 'App-Name', value: 'SeedProtocol' }])).toEqual([
          { name: 'Content-SHA-256', value: 'abc' },
          { name: 'Content-Type', value: 'text/plain' },
          { name: 'App-Name', value: 'SeedProtocol' },
        ])
      })
    })

    describe('Tag Retrieval Flow', () => {
      it('retrieves Content-SHA-256 tag for metadata matching', async () => {
        const id = await node.postTransaction(new Uint8Array([1, 2, 3]), [
          { name: 'Content-SHA-256', value: 'expected-hash-value' },
          { name: 'Content-Type', value: 'application/octet-stream' },
        ])
        const tags = await BaseArweaveClient.getTransactionTags(id)
        expect(tags.find((t) => t.name === 'Content-SHA-256')?.value).toBe('expected-hash-value')
      })
    })

    describe('Bulk Download Flow', () => {
      it('downloads multiple files in batch', async () => {
        const ids = [
          await node.postTransaction(new Uint8Array([1, 2, 3])),
          await node.postTransaction(new Uint8Array([4, 5, 6])),
          await node.postTransaction(new Uint8Array([7, 8, 9])),
        ]
        const results = await BaseArweaveClient.downloadFiles({ transactionIds: ids })
        expect(results.map((r) => [r.transactionId, r.success, [...r.data!]])).toEqual([
          [ids[0], true, [1, 2, 3]],
          [ids[1], true, [4, 5, 6]],
          [ids[2], true, [7, 8, 9]],
        ])
      })

      it('reports why a transaction is unavailable', async () => {
        const [result] = await BaseArweaveClient.downloadFiles({ transactionIds: [MISSING_TX_ID] })
        expect(result).toMatchObject({ transactionId: MISSING_TX_ID, success: false })
        expect(result!.error).toContain('404')
      })

      it('reports a gateway error for one file and keeps the rest of the batch', async () => {
        const broken = await node.postTransaction(new Uint8Array([1, 2, 3]))
        const fine = await node.postTransaction(new Uint8Array([4, 5, 6]))
        node.failRawRead(broken, 500)

        const results = await BaseArweaveClient.downloadFiles({ transactionIds: [broken, fine] })

        expect(results.map((r) => [r.transactionId, r.success])).toEqual([
          [broken, false],
          [fine, true],
        ])
        expect(results[0]!.error).toContain('500')
      })
    })
  })
})
