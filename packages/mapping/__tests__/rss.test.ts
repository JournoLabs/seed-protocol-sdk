import { describe, expect, it } from 'vitest'
import { rssItemToSources, rssXmlToSources } from '../src/adapters/rss'

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

describe('rssItemToSources', () => {
  it('creates rss-* nodes for string-coercible fields', () => {
    const sources = rssItemToSources({
      title: 'Hello',
      link: 'https://example.com/p/1',
      'content:encoded': '<p>Body</p>',
      empty: '',
      nested: { _: 'from underscore' },
    })
    const byId = Object.fromEntries(sources.map((s) => [s.id, s]))
    expect(byId['rss-title']?.value).toBe('Hello')
    expect(byId['rss-content:encoded']?.value).toBe('<p>Body</p>')
    expect(byId['rss-nested']?.value).toBe('from underscore')
    expect(byId['rss-empty']).toBeUndefined()
  })

  it('exposes enclosure url + type in meta (not stringified object)', () => {
    const sources = rssItemToSources({
      title: 'Ep',
      enclosure: {
        url: 'https://cdn.example/ep.mp3',
        type: 'audio/mpeg',
        length: '12345',
      },
    })
    const enc = sources.find((s) => s.id === 'rss-enclosure-0')
    expect(enc?.value).toBe('https://cdn.example/ep.mp3')
    expect(enc?.meta).toMatchObject({
      url: 'https://cdn.example/ep.mp3',
      contentType: 'audio/mpeg',
      length: '12345',
      class: 'audio',
    })
    expect(enc?.value.startsWith('{')).toBe(false)
  })

  it('indexes multiple enclosures', () => {
    const sources = rssItemToSources({
      enclosures: [
        { url: 'https://cdn.example/a.mp3', type: 'audio/mpeg' },
        { url: 'https://cdn.example/cover.png', type: 'image/png' },
      ],
    })
    expect(sources.find((s) => s.id === 'rss-enclosure-0')?.meta?.class).toBe(
      'audio',
    )
    expect(sources.find((s) => s.id === 'rss-enclosure-1')?.meta?.class).toBe(
      'image',
    )
  })
})

describe('rssXmlToSources', () => {
  it('parses channel and item sources', async () => {
    const result = await rssXmlToSources(MINIMAL_RSS)
    expect(result.channel.title).toBe('Test Channel')
    expect(result.items).toHaveLength(1)
    const itemSources = result.items[0]!
    expect(itemSources.find((s) => s.id === 'rss-title')?.value).toBe('Hello')
    expect(itemSources.find((s) => s.id === 'rss-featureImage')?.value).toBe(
      'https://example.com/a.png',
    )
  })
})
