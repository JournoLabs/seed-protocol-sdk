import { describe, expect, it } from 'vitest'
import { DEFAULT_IPFS_GATEWAYS, hasUriScheme, publicStorageUrl } from '../../src/gateway/storageUrl.js'

const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'

describe('publicStorageUrl', () => {
  it('maps ipfs://<cid> to <gateway>/ipfs/<cid> on the first default gateway', () => {
    expect(DEFAULT_IPFS_GATEWAYS).toEqual(['https://ipfs.io', 'https://dweb.link'])
    expect(publicStorageUrl(`ipfs://${CID}`)).toBe(`https://ipfs.io/ipfs/${CID}`)
  })

  it('takes the gateway from ipfsGateway, without a doubled slash', () => {
    expect(publicStorageUrl(`ipfs://${CID}`, { ipfsGateway: 'https://gw.example.com/' })).toBe(
      `https://gw.example.com/ipfs/${CID}`,
    )
  })

  it('gives an Arweave id the public gateway /raw/ URL', () => {
    expect(publicStorageUrl(TX)).toMatch(new RegExp(`^https://[^/]+/raw/${TX}$`))
  })

  it('has no URL for an id with another scheme', () => {
    expect(publicStorageUrl('foo://bar')).toBeUndefined()
    expect(publicStorageUrl('ipfs://')).toBeUndefined()
  })
})

describe('hasUriScheme', () => {
  it('is true for ids written as URIs, false for Arweave ids and seed uids', () => {
    expect(hasUriScheme(`ipfs://${CID}`)).toBe(true)
    expect(hasUriScheme('ar://abc')).toBe(true)
    expect(hasUriScheme(TX)).toBe(false)
    expect(hasUriScheme(`0x${'a'.repeat(64)}`)).toBe(false)
  })
})
