import { describe, it, expect } from 'vitest'
import {
  resolveSeedRssImageRelationRef,
  resolveSeedRssImageRelationFromItem,
} from '../src/resolveSeedRssImageRelationRef.js'

const IMAGE_UID = '0x302bafd11cebdd34606a974f19b7f576a6d74eb775c4b131c5fc9986afc467bb'
const EAS_LINK = `https://optimism-sepolia.easscan.org/attestation/view/${IMAGE_UID}`
const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'

describe('resolveSeedRssImageRelationRef', () => {
  it('returns seedUid only for nested image relation without storage tx', () => {
    expect(
      resolveSeedRssImageRelationRef({
        seedUid: IMAGE_UID,
        link: EAS_LINK,
        timeCreated: 1773361995,
      }),
    ).toEqual({
      seedUid: IMAGE_UID,
    })
  })

  it('never returns EAS explorer URLs as mediaUrl', () => {
    expect(resolveSeedRssImageRelationRef(EAS_LINK)).toBeUndefined()
    expect(
      resolveSeedRssImageRelationRef({
        link: EAS_LINK,
        seedUid: IMAGE_UID,
      })?.mediaUrl,
    ).toBeUndefined()
  })

  it('prefers storageTransactionId and arweaveUrl for mediaUrl', () => {
    const arweaveUrl = `https://arweave.net/${TX}`
    const resolved = resolveSeedRssImageRelationRef({
      seedUid: IMAGE_UID,
      storageTransactionId: TX,
      arweaveUrl,
      link: EAS_LINK,
    })
    expect(resolved).toMatchObject({
      seedUid: IMAGE_UID,
      storageTransactionId: TX,
      arweaveUrl,
    })
    expect(resolved?.mediaUrl).toContain(TX)
  })

  it('resolves mediaUrl from plain tx id strings', () => {
    const resolved = resolveSeedRssImageRelationRef(TX)
    expect(resolved?.storageTransactionId).toBe(TX)
    expect(resolved?.mediaUrl).toContain(TX)
  })

  it('reads namespaced nested relation keys', () => {
    expect(
      resolveSeedRssImageRelationRef({
        'featureimage:seedUid': IMAGE_UID,
        'featureimage:link': EAS_LINK,
      }),
    ).toEqual({
      seedUid: IMAGE_UID,
    })
  })
})

describe('resolveSeedRssImageRelationFromItem', () => {
  it('finds the first configured image relation field on an item', () => {
    expect(
      resolveSeedRssImageRelationFromItem({
        title: 'Post',
        featureImage: {
          seedUid: IMAGE_UID,
          link: EAS_LINK,
        },
      }),
    ).toEqual({
      seedUid: IMAGE_UID,
    })
  })

  describe('with an ipfs:// storage id', () => {
    const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

    it('maps the id to a path gateway URL, not to an Arweave /raw/ URL', () => {
      const resolved = resolveSeedRssImageRelationRef(`ipfs://${CID}`)
      expect(resolved).toEqual({ storageTransactionId: `ipfs://${CID}`, mediaUrl: `https://ipfs.io/ipfs/${CID}` })
      expect(resolveSeedRssImageRelationRef({ storageTransactionId: `ipfs://${CID}` })?.mediaUrl).toBe(
        `https://ipfs.io/ipfs/${CID}`,
      )
    })

    it('uses the ipfsGateway option', () => {
      const options = { ipfsGateway: 'https://gw.example.com/' }
      expect(resolveSeedRssImageRelationRef(`ipfs://${CID}`, options)?.mediaUrl).toBe(
        `https://gw.example.com/ipfs/${CID}`,
      )
      expect(
        resolveSeedRssImageRelationRef([{ storage_transaction_id: `ipfs://${CID}` }], options)?.mediaUrl,
      ).toBe(`https://gw.example.com/ipfs/${CID}`)
      expect(
        resolveSeedRssImageRelationFromItem({ image: { storageTransactionId: `ipfs://${CID}` } }, undefined, options)
          ?.mediaUrl,
      ).toBe(`https://gw.example.com/ipfs/${CID}`)
    })

    it('gives no URL for another scheme it cannot map', () => {
      expect(resolveSeedRssImageRelationRef('foo://bar')?.mediaUrl).toBeUndefined()
    })
  })
})
