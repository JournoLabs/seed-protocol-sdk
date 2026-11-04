import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseArweaveClient } from '../../src/ArweaveClient/BaseArweaveClient.js'
import type { IArweaveClient } from '../../src/ArweaveClient/IArweaveClient.js'
import { resetArweaveReadGatewayForTests } from '../../src/ArweaveClient/selectReadGateway.js'
import {
  hasArweaveContentReadTransform,
  isEncryptedArweaveContent,
  readArweaveContentResponse,
  setArweaveContentReadTransform,
  type ArweaveContentReadTransform,
} from '../../src/content/arweaveContent.js'
import {
  setPreferredArweaveReadBaseUrls,
  setResolvedSeedGatewayEndpoints,
} from '../../src/gateway/gatewayState.js'
import { fetchArweaveRawTextAcrossGateways } from '../../src/gateway/readBaseUrls.js'

const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const PROXY = 'https://app.example.com/api/seed-gateway'

/** Stand-in for a decrypt step: upper-cases text and records what it saw. */
const seen: { transactionId: string; contentType?: string }[] = []
const upperCase: ArweaveContentReadTransform = ({ bytes, contentType }, { transactionId }) => {
  seen.push({ transactionId, contentType })
  return { bytes: new TextEncoder().encode(new TextDecoder().decode(bytes).toUpperCase()), contentType }
}

beforeEach(() => {
  seen.length = 0
  resetArweaveReadGatewayForTests()
  setResolvedSeedGatewayEndpoints(null)
  setPreferredArweaveReadBaseUrls([PROXY])
})

afterEach(() => {
  setArweaveContentReadTransform(undefined)
  setPreferredArweaveReadBaseUrls([])
  vi.unstubAllGlobals()
})

describe('Arweave content read seam', () => {
  it('passes content through unchanged when no transform is registered', async () => {
    expect(hasArweaveContentReadTransform()).toBe(false)
    const content = await readArweaveContentResponse(
      new Response('<p>hi</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      { transactionId: TX },
    )
    expect(new TextDecoder().decode(content.bytes)).toBe('<p>hi</p>')
    expect(content.contentType).toBe('text/html')
  })

  it('fetchArweaveRawTextAcrossGateways returns transformed content', async () => {
    setArweaveContentReadTransform(upperCase)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<p>hi</p>', { status: 200, headers: { 'content-type': 'text/html' } })),
    )

    await expect(fetchArweaveRawTextAcrossGateways(TX)).resolves.toBe('<P>HI</P>')
    expect(seen).toEqual([{ transactionId: TX, contentType: 'text/html' }])
  })

  describe('encrypted envelopes', () => {
    const ENVELOPE = 'seed-private/v1\nbind e30\n-> x-test\nAQ\n--- AAAA\n\u0000\u0001ciphertext'
    const envelopeResponse = () =>
      vi.fn(async () => new Response(ENVELOPE, { status: 200, headers: { 'content-type': 'application/octet-stream' } }))

    it('recognises the envelope version line only at the start', () => {
      const enc = new TextEncoder()
      expect(isEncryptedArweaveContent(enc.encode(ENVELOPE))).toBe(true)
      expect(isEncryptedArweaveContent(enc.encode('seed-private/v1'))).toBe(false)
      expect(isEncryptedArweaveContent(enc.encode(' seed-private/v1\n'))).toBe(false)
      expect(isEncryptedArweaveContent(enc.encode('<p>seed-private/v1\n</p>'))).toBe(false)
    })

    it('a text read returns nothing for an envelope no transform opened', async () => {
      vi.stubGlobal('fetch', envelopeResponse())
      await expect(fetchArweaveRawTextAcrossGateways(TX)).resolves.toBeUndefined()
    })

    it('a text read returns what a transform decrypted', async () => {
      vi.stubGlobal('fetch', envelopeResponse())
      setArweaveContentReadTransform(({ bytes }) =>
        isEncryptedArweaveContent(bytes) ? { bytes: new TextEncoder().encode('<p>opened</p>'), contentType: 'text/html' } : { bytes },
      )
      await expect(fetchArweaveRawTextAcrossGateways(TX)).resolves.toBe('<p>opened</p>')
    })
  })

  describe('BaseArweaveClient.getTransactionData', () => {
    const getTransactionData = vi.fn(async (_id: string, options?: { string?: boolean }) =>
      options?.string ? 'abc' : new TextEncoder().encode('abc'),
    )

    beforeEach(() => {
      getTransactionData.mockClear()
      BaseArweaveClient.configure({ getTransactionData } as unknown as IArweaveClient)
    })

    it('returns the platform client result untouched without a transform', async () => {
      await expect(BaseArweaveClient.getTransactionData(TX, { string: true })).resolves.toBe('abc')
    })

    it('transforms decoded data, as string or bytes', async () => {
      setArweaveContentReadTransform(upperCase)
      await expect(BaseArweaveClient.getTransactionData(TX, { string: true })).resolves.toBe('ABC')
      const bytes = await BaseArweaveClient.getTransactionData(TX)
      expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('ABC')
      expect(seen.map((s) => s.transactionId)).toEqual([TX, TX])
    })

    it('leaves decode: false (encoded) data alone', async () => {
      setArweaveContentReadTransform(upperCase)
      await expect(
        BaseArweaveClient.getTransactionData(TX, { decode: false, string: true }),
      ).resolves.toBe('abc')
      expect(seen).toEqual([])
    })
  })
})
