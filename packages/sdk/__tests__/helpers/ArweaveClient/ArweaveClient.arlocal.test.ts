/**
 * BaseArweaveClient with the real Node client against a local Arweave node (arlocal), so every
 * request goes over HTTP the way it does against a gateway, with no public gateway involved.
 * Reads are pinned to the local node (ARWEAVE_READ_GATEWAYS), so the public fallbacks are never
 * asked. ArweaveClient.test.ts covers the facade against MockArweaveClient, and
 * ArweaveClient.live.test.ts reads from public gateways on request.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  BaseArweaveClient,
  invalidateReadGatewayCache,
  setPreferredArweaveReadBaseUrls,
} from '@seedprotocol/arweave'
import '@seedprotocol/arweave/node'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { startLocalArweave, type LocalArweave } from '../../test-utils/arlocal'

const isNodeEnv = typeof window === 'undefined'
const MISSING_TX_ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const BINARY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 254, 255])
const TEXT = 'Seed Protocol on a local Arweave node\n'

const decodeTag = (value: string) => new TextDecoder().decode(Buffer.from(value, 'base64url'))

describe.skipIf(!isNodeEnv)('BaseArweaveClient against a local Arweave node', () => {
  let node: LocalArweave
  let binaryTx: string
  let textTx: string
  const previousReadGateways = process.env.ARWEAVE_READ_GATEWAYS
  const realFetch = globalThis.fetch
  const offLocalRequests: string[] = []

  beforeAll(async () => {
    // Any request that leaves this machine fails the test (see the last test).
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url).hostname !== '127.0.0.1') {
        offLocalRequests.push(url)
        return Promise.reject(new Error(`off-machine request in a local test: ${url}`))
      }
      return realFetch(input, init)
    }) as typeof fetch
    node = await startLocalArweave()
    process.env.ARWEAVE_READ_GATEWAYS = node.host
    BaseArweaveClient.setHost(node.baseUrl)
    setPreferredArweaveReadBaseUrls([])
    BaseArweaveClient.resetReadGatewaySelectionStateForTests()
    invalidateReadGatewayCache()

    binaryTx = await node.postTransaction(BINARY, [{ name: 'Content-Type', value: 'image/png' }])
    textTx = await node.postTransaction(TEXT, [
      { name: 'Content-Type', value: 'text/plain' },
      { name: 'App-Name', value: 'seed-protocol-test' },
    ])
  }, 60000)

  afterAll(async () => {
    globalThis.fetch = realFetch
    if (previousReadGateways === undefined) delete process.env.ARWEAVE_READ_GATEWAYS
    else process.env.ARWEAVE_READ_GATEWAYS = previousReadGateways
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
    invalidateReadGatewayCache()
    await node?.stop()
  })

  describe('getTransactionStatus()', () => {
    it('is 200 for a transaction the gateway has', async () => {
      expect(await BaseArweaveClient.getTransactionStatus(textTx)).toEqual({ status: 200, confirmed: null })
    })

    it('is 404 for a well-formed id the gateway lacks', async () => {
      const status = await BaseArweaveClient.getTransactionStatus(MISSING_TX_ID)
      expect(status).toEqual({ status: 404, confirmed: null })
    })
  })

  describe('getTransactionData()', () => {
    it('returns the bytes that were posted', async () => {
      const data = await BaseArweaveClient.getTransactionData(binaryTx)
      expect(data).toBeInstanceOf(Uint8Array)
      expect([...(data as Uint8Array)]).toEqual([...BINARY])
    })

    it('returns a string with string: true', async () => {
      expect(await BaseArweaveClient.getTransactionData(textTx, { string: true })).toBe(TEXT)
    })

    it('throws for a transaction the gateway lacks', async () => {
      await expect(BaseArweaveClient.getTransactionData(MISSING_TX_ID)).rejects.toThrow()
    })
  })

  describe('getTransactionTags()', () => {
    it('returns the posted tags through GraphQL', async () => {
      expect(await BaseArweaveClient.getTransactionTags(textTx)).toEqual([
        { name: 'Content-Type', value: 'text/plain' },
        { name: 'App-Name', value: 'seed-protocol-test' },
      ])
    })

    it('returns [] for a transaction the gateway lacks', async () => {
      expect(await BaseArweaveClient.getTransactionTags(MISSING_TX_ID)).toEqual([])
    })
  })

  describe('createTransaction()', () => {
    it('creates an unsigned transaction for string data, priced by the gateway', async () => {
      const tx = await BaseArweaveClient.createTransaction('hello')
      expect(tx.data_size).toBe('5')
      expect(Number(tx.reward)).toBeGreaterThan(0)
      expect(tx.last_tx).toBeTruthy()
      expect(tx.signature).toBe('')
    })

    it('creates an unsigned transaction for Uint8Array data', async () => {
      const tx = await BaseArweaveClient.createTransaction(BINARY)
      expect(tx.data_size).toBe(String(BINARY.byteLength))
    })

    it('adds tags', async () => {
      const tx = await BaseArweaveClient.createTransaction('tagged', {
        tags: [{ name: 'Content-Type', value: 'text/plain' }],
      })
      expect(tx.tags.map((t: { name: string; value: string }) => [decodeTag(t.name), decodeTag(t.value)])).toEqual([
        ['Content-Type', 'text/plain'],
      ])
    })

    it('posts and serves a transaction once signed', async () => {
      const id = await node.postTransaction('round trip')
      expect(await BaseArweaveClient.getTransactionData(id, { string: true })).toBe('round trip')
    })
  })

  describe('URLs', () => {
    it('point at the configured local gateway', () => {
      expect(BaseArweaveClient.getRawUrl(textTx)).toBe(`${node.baseUrl}/raw/${textTx}`)
      expect(BaseArweaveClient.getStatusUrl(textTx)).toBe(`${node.baseUrl}/${textTx}`)
      expect(BaseArweaveClient.getEndpoint()).toBe(`${node.baseUrl}/graphql`)
    })
  })

  describe('downloadFiles()', () => {
    it('downloads a file with its content type', async () => {
      const [result] = await BaseArweaveClient.downloadFiles({ transactionIds: [binaryTx] })
      expect(result).toMatchObject({ transactionId: binaryTx, success: true, contentType: 'image/png' })
      expect([...result!.data!]).toEqual([...BINARY])
    })

    it('reports a missing transaction alongside one that downloads', async () => {
      const results = await BaseArweaveClient.downloadFiles({ transactionIds: [textTx, MISSING_TX_ID] })
      expect(results.map((r) => [r.transactionId, r.success])).toEqual([
        [textTx, true],
        [MISSING_TX_ID, false],
      ])
    })

    it('skips excluded transactions', async () => {
      const results = await BaseArweaveClient.downloadFiles({
        transactionIds: [textTx, binaryTx],
        excludedTransactions: new Set([binaryTx]),
      })
      expect(results.map((r) => r.transactionId)).toEqual([textTx])
    })
  })

  it('made no request off this machine', () => {
    expect(offLocalRequests).toEqual([])
  })
})
