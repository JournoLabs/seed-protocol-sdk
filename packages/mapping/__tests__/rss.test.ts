import { describe, expect, it } from 'vitest'
import { rssItemToSources, rssXmlToSources } from '../src/adapters/rss'
import { applyMapping } from '../src/applyMapping'
import { collectLookupValues } from '../src/relationLookup'
import type { FieldMapping, TargetProperty, UnmatchedLookup } from '../src/types'

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

const REPEATED_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Bylines</title>
    <item>
      <title>Both</title>
      <dc:creator>Mira Chen</dc:creator>
      <dc:creator><![CDATA[Sam Ortiz]]></dc:creator>
      <dc:creator>mira chen</dc:creator>
    </item>
    <item>
      <title>One</title>
      <dc:creator>Mira Chen</dc:creator>
    </item>
  </channel>
</rss>`

const REPEATED_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Bylines</title>
  <entry>
    <title>Both</title>
    <author><name>Mira Chen</name></author>
    <author><name>Sam Ortiz</name></author>
  </entry>
</feed>`

describe('repeated bylines', () => {
  const authors: TargetProperty = { name: 'authors', dataType: 'List', refValueType: 'Relation', ref: 'Identity' }
  const author: TargetProperty = { name: 'author', dataType: 'Relation', ref: 'Identity' }
  const title: TargetProperty = { name: 'title', dataType: 'Text' }
  const edge = (sourceId: string, entries: { value: string; refs: string[] }[], propertyName = 'authors'): FieldMapping => ({
    sourceId,
    propertyName,
    resolve: 'lookup',
    lookup: { entries },
  })
  const people = [
    { value: 'Mira Chen', refs: ['mira'] },
    { value: 'Sam Ortiz', refs: ['sam'] },
  ]

  it('keeps every dc:creator, in order, once per lookup key', async () => {
    const { items } = await rssXmlToSources(REPEATED_RSS)
    const creator = items[0]!.find((s) => s.id === 'rss-creator')
    expect(creator?.value).toBe('Mira Chen')
    expect(creator?.values).toEqual(['Mira Chen', 'Sam Ortiz'])
    expect(items[0]!.find((s) => s.id === 'rss-dc:creator')?.values).toEqual(['Mira Chen', 'Sam Ortiz'])
  })

  it('leaves a single byline a plain value and adds no source for the list', async () => {
    const { items } = await rssXmlToSources(REPEATED_RSS)
    expect(items[1]!.find((s) => s.id === 'rss-creator')?.values).toBeUndefined()
    expect(items[0]!.some((s) => /List$/.test(s.label))).toBe(false)
  })

  it('keeps every Atom author', async () => {
    const { items } = await rssXmlToSources(REPEATED_ATOM)
    const node = items[0]!.find((s) => s.id === 'rss-author')
    expect(node?.values).toEqual(['Mira Chen', 'Sam Ortiz'])
  })

  it('applies each value to a List lookup target', async () => {
    const { items } = await rssXmlToSources(REPEATED_RSS)
    expect(applyMapping(items[0]!, [edge('rss-creator', people)], [authors])).toEqual({ authors: ['mira', 'sam'] })
  })

  it('applies the known people and reports each unknown one', async () => {
    const { items } = await rssXmlToSources(REPEATED_RSS)
    const misses: UnmatchedLookup[] = []
    const bag = applyMapping(items[0]!, [edge('rss-creator', [people[1]!])], [authors], {
      onUnmatched: (miss) => misses.push(miss),
    })
    expect(bag).toEqual({ authors: ['sam'] })
    expect(misses).toEqual([{ sourceId: 'rss-creator', propertyName: 'authors', value: 'Mira Chen' }])
  })

  it('gives a Relation target the first ref and a copy edge the first value', async () => {
    const { items } = await rssXmlToSources(REPEATED_RSS)
    const copy: FieldMapping = { sourceId: 'rss-creator', propertyName: 'title' }
    expect(applyMapping(items[0]!, [edge('rss-creator', people, 'author'), copy], [author, title])).toEqual({
      author: 'mira',
      title: 'Mira Chen',
    })
  })

  it('collects each value across the feed', async () => {
    const { items } = await rssXmlToSources(REPEATED_RSS)
    expect(collectLookupValues(items, edge('rss-creator', []))).toEqual(['Mira Chen', 'Sam Ortiz'])
  })
})
