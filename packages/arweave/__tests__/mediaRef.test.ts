import { describe, it, expect } from 'vitest'
import {
  classifyMediaRef,
  normalizeFeedItemFields,
  getFeedItemStringField,
} from '../src/mediaRef.js'

const TX_43 = 'a'.repeat(43)

describe('classifyMediaRef', () => {
  it('returns empty for blank', () => {
    expect(classifyMediaRef('')).toEqual({ kind: 'empty' })
    expect(classifyMediaRef('   ')).toEqual({ kind: 'empty' })
  })

  it('classifies urls', () => {
    expect(classifyMediaRef('https://example.com/x.png')).toEqual({
      kind: 'url',
      href: 'https://example.com/x.png',
    })
  })

  it('classifies EAS attestation explorer URLs as non-media', () => {
    expect(
      classifyMediaRef(
        'https://optimism-sepolia.easscan.org/attestation/view/0x302bafd11cebdd34606a974f19b7f576a6d74eb775c4b131c5fc9986afc467bb',
      ),
    ).toEqual({
      kind: 'nonMediaUrl',
      href: 'https://optimism-sepolia.easscan.org/attestation/view/0x302bafd11cebdd34606a974f19b7f576a6d74eb775c4b131c5fc9986afc467bb',
    })
  })

  it('classifies arweave tx ids', () => {
    expect(classifyMediaRef(TX_43)).toEqual({ kind: 'arweaveTxId', txId: TX_43 })
  })

  it('respects treatAs overrides', () => {
    expect(classifyMediaRef('hello', { treatAs: 'url' })).toEqual({
      kind: 'url',
      href: 'hello',
    })
    const uid = '0x' + 'c'.repeat(64)
    expect(classifyMediaRef(uid, { treatAs: 'seedUid' })).toEqual({ kind: 'seedUid', uid })
  })
})

describe('normalizeFeedItemFields', () => {
  it('maps manifest keys and classifies media roles', () => {
    const item = {
      featureImage: TX_43,
      body: '  <p>Hi</p>  ',
      title: '  T  ',
    }
    const manifest = {
      featureImage: { role: 'image' as const },
      body: { role: 'html' as const },
      title: { role: 'text' as const },
    }
    const n = normalizeFeedItemFields(item, manifest)
    expect(n.featureImage?.role).toBe('image')
    if (n.featureImage && n.featureImage.role === 'image') {
      expect(n.featureImage.classification).toEqual({ kind: 'arweaveTxId', txId: TX_43 })
    }
    expect(n.body).toEqual({ role: 'html', raw: '<p>Hi</p>' })
    expect(n.title).toEqual({ role: 'text', raw: 'T' })
  })
})

describe('getFeedItemStringField', () => {
  it('coalesces camel and snake keys', () => {
    expect(getFeedItemStringField({ feature_image: 'x' }, 'featureImage')).toBe('x')
    expect(getFeedItemStringField({ featureImage: 'y' }, 'feature_image')).toBe('y')
  })
})
