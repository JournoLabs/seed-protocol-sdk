import { describe, it, expect } from 'vitest'
import { parseRssString } from '../src/consume/parseRss'
import {
  normalizeFeedItemFields,
  resolveSeedRssImageRelationFromItem,
} from '@seedprotocol/arweave'

const MINIMAL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Channel</title>
    <link>https://example.com/feed</link>
    <description>Desc</description>
    <item>
      <title>Hello</title>
      <link>https://example.com/p/1</link>
      <description>Snippet</description>
      <featureImage>https://example.com/a.png</featureImage>
    </item>
  </channel>
</rss>`

describe('parseRssString', () => {
  it('parses channel and items', async () => {
    const parsed = await parseRssString(MINIMAL_RSS)
    expect(parsed.title).toBe('Test Channel')
    expect(parsed.link).toBe('https://example.com/feed')
    expect(parsed.items).toHaveLength(1)
    const item = parsed.items[0]!
    expect(item['title']).toBe('Hello')
    expect(item['link']).toBe('https://example.com/p/1')
    expect(item['featureImage']).toBe('https://example.com/a.png')
  })

  it('works with normalizeFeedItemFields from a parsed item', async () => {
    const { items } = await parseRssString(MINIMAL_RSS)
    const item = items[0] as Record<string, unknown>
    const normalized = normalizeFeedItemFields(item, {
      featureImage: { role: 'image' },
      title: { role: 'text' },
    })
    expect(normalized.title?.role).toBe('text')
    if (normalized.featureImage && normalized.featureImage.role === 'image') {
      expect(normalized.featureImage.classification.kind).toBe('url')
    }
  })

  it('resolveSeedRssImageRelationFromItem ignores EAS explorer URLs on nested objects', () => {
    const imageUid =
      '0x302bafd11cebdd34606a974f19b7f576a6d74eb775c4b131c5fc9986afc467bb'
    const easLink = `https://optimism-sepolia.easscan.org/attestation/view/${imageUid}`
    expect(
      resolveSeedRssImageRelationFromItem({
        featureImage: {
          seedUid: imageUid,
          link: easLink,
        },
      }),
    ).toEqual({
      seedUid: imageUid,
    })
  })
})
