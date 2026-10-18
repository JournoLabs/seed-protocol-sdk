import { describe, expect, it } from 'vitest'
import { sha3_256 } from '@noble/hashes/sha3'
import { bytesToHex } from '@noble/hashes/utils'
import {
  buildArweaveContentTags,
  contentSha256TagMatches,
  getContentSha256,
} from '@/helpers/arweaveContentTags'

const bytes = new TextEncoder().encode('<p>hello</p>')

describe('arweaveContentTags', () => {
  it('Content-SHA-256 is SHA-256 (same digest as WebCrypto)', async () => {
    const webCrypto = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    expect(getContentSha256(bytes)).toBe(webCrypto)
  })

  it('accepts SHA-256 and legacy SHA3-256 tag values, nothing else', () => {
    expect(contentSha256TagMatches(bytes, getContentSha256(bytes))).toBe(true)
    expect(contentSha256TagMatches(bytes, getContentSha256(bytes).toUpperCase())).toBe(true)
    expect(contentSha256TagMatches(bytes, bytesToHex(sha3_256(bytes)))).toBe(true)
    expect(contentSha256TagMatches(bytes, getContentSha256(new Uint8Array([1])))).toBe(false)
    expect(contentSha256TagMatches(bytes, '')).toBe(false)
  })

  it('orders tags: hash, content type, then extra tags', () => {
    expect(
      buildArweaveContentTags('abc', 'text/html', [{ name: 'App-Name', value: 'x' }]),
    ).toEqual([
      { name: 'Content-SHA-256', value: 'abc' },
      { name: 'Content-Type', value: 'text/html' },
      { name: 'App-Name', value: 'x' },
    ])
    expect(buildArweaveContentTags(undefined, undefined)).toEqual([])
  })
})
