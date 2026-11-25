import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobFileKey, fetchBlobBytes, resolveBlobSource, setBlobSources, type BlobSource } from '@/storageValue/blobSources'
import { getContentSha256 } from '@/helpers/arweaveContentTags'
import { resolveStorageRef } from '@/storageValue/resolve'

const KEY = 'bafk' + 'q'.repeat(55)
const BODY = new TextEncoder().encode('<p>from ipfs</p>')

const ipfs = (overrides: Partial<BlobSource> = {}): BlobSource => ({
  id: 'ipfs',
  key: (id) => (id.startsWith('ipfs://') ? id.slice(7) : id.startsWith('bafk') ? id : undefined),
  urls: (key) => [`https://a.example.com/ipfs/${key}`, `https://b.example.com/ipfs/${key}`],
  ...overrides,
})

describe('blob sources', () => {
  afterEach(() => {
    setBlobSources([])
    vi.unstubAllGlobals()
  })

  it('leave every id to Arweave when none is configured', () => {
    expect(resolveBlobSource(`ipfs://${KEY}`)).toBeUndefined()
    expect(blobFileKey(`ipfs://${KEY}`)).toBe(`ipfs://${KEY}`)
  })

  it('give the key of an id a source claims, for the id and for the key itself', () => {
    setBlobSources([ipfs()])
    expect(resolveBlobSource(`ipfs://${KEY}`)?.key).toBe(KEY)
    expect(resolveBlobSource(KEY)?.key).toBe(KEY)
    expect(resolveBlobSource('JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY')).toBeUndefined()
  })

  it('ignore a key that cannot name a file', () => {
    setBlobSources([ipfs({ key: (id) => id.replace('ipfs://', 'dir/') })])
    expect(resolveBlobSource(`ipfs://${KEY}`)).toBeUndefined()
  })

  it('name a synced Image or File by the key, so readers look for the downloaded file', async () => {
    setBlobSources([ipfs()])
    expect((await resolveStorageRef('image', { refResolvedValue: `ipfs://${KEY}` })).refResolvedValue).toBe(KEY)
    expect((await resolveStorageRef('file', { refResolvedValue: `ipfs://${KEY}` })).refResolvedValue).toBe(KEY)
  })

  it('fetch the first URL whose bytes match the hash the source gives', async () => {
    setBlobSources([ipfs({ sha256: () => getContentSha256(BODY) })])
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return new Response(url.includes('a.example.com') ? 'gateway error page' : BODY, { status: 200 })
    })
    const bytes = await fetchBlobBytes(resolveBlobSource(KEY)!)
    expect(new TextDecoder().decode(bytes)).toBe('<p>from ipfs</p>')
    expect(fetched).toHaveLength(2)
  })

  it('return nothing when no URL serves matching bytes', async () => {
    setBlobSources([ipfs({ sha256: () => 'ab'.repeat(32) })])
    vi.stubGlobal('fetch', async () => new Response(BODY, { status: 200 }))
    expect(await fetchBlobBytes(resolveBlobSource(KEY)!)).toBeUndefined()
  })

  it('warn once, naming what each URL answered, when none serves the bytes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      setBlobSources([ipfs({ sha256: () => 'ab'.repeat(32) })])
      vi.stubGlobal('fetch', async (url: string) =>
        url.includes('a.example.com') ? new Response('nope', { status: 404 }) : new Response(BODY, { status: 200 }),
      )
      expect(await fetchBlobBytes(resolveBlobSource(KEY)!)).toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]![0])
      expect(line).toContain(KEY)
      expect(line).toContain('https://a.example.com/ipfs/' + KEY + ' 404')
      expect(line).toContain('https://b.example.com/ipfs/' + KEY + ' hash mismatch')

      // The same id again is not repeated.
      await fetchBlobBytes(resolveBlobSource(KEY)!)
      expect(warn).toHaveBeenCalledTimes(1)

      // A different failure for the same id is reported.
      vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }))
      await fetchBlobBytes(resolveBlobSource(KEY)!)
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[1]![0])).toContain(' 503')
    } finally {
      warn.mockRestore()
    }
  })

  it('name an empty body and a network error, and stay quiet when a URL serves the bytes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      setBlobSources([ipfs()])
      let call = 0
      vi.stubGlobal('fetch', async () => {
        call++
        if (call === 1) throw new Error('offline')
        return new Response('', { status: 200 })
      })
      expect(await fetchBlobBytes(resolveBlobSource(KEY)!)).toBeUndefined()
      const line = String(warn.mock.calls[0]![0])
      expect(line).toContain('network error')
      expect(line).toContain('empty body')

      warn.mockClear()
      setBlobSources([ipfs()])
      vi.stubGlobal('fetch', async (url: string) =>
        url.includes('a.example.com') ? new Response('', { status: 500 }) : new Response(BODY, { status: 200 }),
      )
      expect(await fetchBlobBytes(resolveBlobSource(KEY)!)).toBeDefined()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
