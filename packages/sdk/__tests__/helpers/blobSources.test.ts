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
})
