import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  normalizeUploadApiBaseUrl,
  getUploadApiArweaveDataUrl,
  getUploadPipelineTransactionStatus,
} from '@/helpers/ArweaveClient/uploadApiVerification'

describe('uploadApiVerification', () => {
  describe('normalizeUploadApiBaseUrl()', () => {
    it('trims and removes trailing slashes', () => {
      expect(normalizeUploadApiBaseUrl('  https://api.example.com/  ')).toBe('https://api.example.com')
      expect(normalizeUploadApiBaseUrl('https://api.example.com///')).toBe('https://api.example.com')
    })
  })

  describe('getUploadApiArweaveDataUrl()', () => {
    it('builds the upload API data verification path', () => {
      const url = getUploadApiArweaveDataUrl('https://upload.example.com', 'abc123')
      expect(url).toBe('https://upload.example.com/api/upload/arweave/data/abc123')
    })

    it('encodes ids that need encoding', () => {
      const url = getUploadApiArweaveDataUrl('https://upload.example.com', 'a/b')
      expect(url).toBe('https://upload.example.com/api/upload/arweave/data/a%2Fb')
    })
  })

  describe('getUploadPipelineTransactionStatus()', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch,
      )
    })

    afterEach(() => {
      vi.stubGlobal('fetch', originalFetch)
      vi.restoreAllMocks()
    })

    it('requests the upload API data URL', async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
      await getUploadPipelineTransactionStatus('https://upload.example.com', 'tx1')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://upload.example.com/api/upload/arweave/data/tx1',
      )
    })

    it('returns 404 when the API responds 404', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch,
      )
      const status = await getUploadPipelineTransactionStatus('https://upload.example.com', 'missing')
      expect(status.status).toBe(404)
      expect(status.confirmed).toBeNull()
    })

    it('returns non-ok status when the API errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.resolve(new Response(null, { status: 503 }))) as typeof fetch,
      )
      const status = await getUploadPipelineTransactionStatus('https://upload.example.com', 'tx')
      expect(status.status).toBe(503)
    })

    it('returns 200 on success', async () => {
      const status = await getUploadPipelineTransactionStatus('https://upload.example.com', 'ok')
      expect(status.status).toBe(200)
      expect(status.confirmed).toBeNull()
    })

    it('returns 500 on network failure', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new Error('network'))) as typeof fetch,
      )
      const status = await getUploadPipelineTransactionStatus('https://upload.example.com', 'x')
      expect(status.status).toBe(500)
    })
  })
})
