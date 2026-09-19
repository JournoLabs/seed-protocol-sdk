import { describe, expect, it } from 'vitest'
import { autoMap } from '../src/autoMap'
import type { SourceNode, TargetProperty } from '../src/types'

describe('autoMap', () => {
  it('maps full document to body-like property', () => {
    const sources: SourceNode[] = [
      { id: 'section-full', label: 'Full document', kind: 'full', value: 'x' },
      { id: 'fm-title', label: 'title', kind: 'frontmatter', value: 'T' },
    ]
    const targets: TargetProperty[] = [
      { name: 'body', dataType: 'Text' },
      { name: 'title', dataType: 'String' },
    ]
    const mappings = autoMap(sources, targets)
    expect(mappings).toEqual(
      expect.arrayContaining([
        { sourceId: 'section-full', propertyName: 'body' },
        { sourceId: 'fm-title', propertyName: 'title' },
      ]),
    )
    expect(mappings).toHaveLength(2)
  })

  it('maps RSS aliases like content:encoded → html', () => {
    const sources: SourceNode[] = [
      {
        id: 'rss-content:encoded',
        label: 'content:encoded',
        kind: 'rssField',
        value: '<p>Hi</p>',
      },
      {
        id: 'rss-featureImage',
        label: 'featureImage',
        kind: 'rssField',
        value: 'https://example.com/a.png',
        meta: { url: 'https://example.com/a.png', class: 'image' },
      },
    ]
    const targets: TargetProperty[] = [
      { name: 'html', dataType: 'Text' },
      { name: 'featureImage', dataType: 'Relation' },
      { name: 'title', dataType: 'String' },
    ]
    const mappings = autoMap(sources, targets)
    expect(mappings.find((m) => m.sourceId === 'rss-content:encoded')?.propertyName).toBe(
      'html',
    )
    expect(mappings.find((m) => m.sourceId === 'rss-featureImage')).toEqual({
      sourceId: 'rss-featureImage',
      propertyName: 'featureImage',
      resolve: 'file',
    })
  })

  it('does not map raw link URL onto html without resolve', () => {
    const sources: SourceNode[] = [
      {
        id: 'rss-link',
        label: 'link',
        kind: 'rssField',
        value: 'https://example.com/p/1',
      },
    ]
    const targets: TargetProperty[] = [
      { name: 'html', dataType: 'Html' },
      { name: 'importUrl', dataType: 'String' },
    ]
    const mappings = autoMap(sources, targets)
    expect(mappings.find((m) => m.propertyName === 'importUrl')).toEqual({
      sourceId: 'rss-link',
      propertyName: 'importUrl',
    })
    expect(mappings.find((m) => m.propertyName === 'html')).toEqual({
      sourceId: 'rss-link',
      propertyName: 'html',
      resolve: 'extract',
    })
  })

  it('maps audio enclosure to File with resolve:file', () => {
    const sources: SourceNode[] = [
      {
        id: 'rss-enclosure-0',
        label: 'enclosure[0]',
        kind: 'rssField',
        value: 'https://cdn.example/ep.mp3',
        meta: {
          url: 'https://cdn.example/ep.mp3',
          contentType: 'audio/mpeg',
          class: 'audio',
        },
      },
    ]
    const targets: TargetProperty[] = [
      { name: 'audio', dataType: 'File' },
      { name: 'title', dataType: 'String' },
    ]
    const mappings = autoMap(sources, targets)
    expect(mappings).toContainEqual({
      sourceId: 'rss-enclosure-0',
      propertyName: 'audio',
      resolve: 'file',
    })
  })

  it('does not assign the same property twice', () => {
    const sources: SourceNode[] = [
      { id: 'a', label: 'title', kind: 'frontmatter', value: '1' },
      { id: 'b', label: 'Title Page', kind: 'section', value: '2' },
    ]
    const targets: TargetProperty[] = [{ name: 'title', dataType: 'String' }]
    const mappings = autoMap(sources, targets)
    expect(mappings.filter((m) => m.propertyName === 'title')).toHaveLength(1)
  })

  it('fans link out to importUrl and canonicalUrl', () => {
    const sources: SourceNode[] = [
      {
        id: 'rss-link',
        label: 'link',
        kind: 'rssField',
        value: 'https://example.com/p/1',
      },
      {
        id: 'rss-title',
        label: 'title',
        kind: 'rssField',
        value: 'Hello',
      },
    ]
    const targets: TargetProperty[] = [
      { name: 'importUrl', dataType: 'String' },
      { name: 'canonicalUrl', dataType: 'String' },
      { name: 'title', dataType: 'String' },
    ]
    const mappings = autoMap(sources, targets)
    const linkMappings = mappings.filter((m) => m.sourceId === 'rss-link')
    expect(linkMappings).toEqual(
      expect.arrayContaining([
        { sourceId: 'rss-link', propertyName: 'importUrl' },
        { sourceId: 'rss-link', propertyName: 'canonicalUrl' },
      ]),
    )
    expect(linkMappings).toHaveLength(2)
    expect(mappings.filter((m) => m.sourceId === 'rss-title')).toEqual([
      { sourceId: 'rss-title', propertyName: 'title' },
    ])
  })

  it('keeps non-fan-out sources 1:1', () => {
    const sources: SourceNode[] = [
      { id: 'fm-title', label: 'title', kind: 'frontmatter', value: 'T' },
    ]
    const targets: TargetProperty[] = [
      { name: 'title', dataType: 'String' },
      { name: 'headline', dataType: 'String' },
    ]
    const mappings = autoMap(sources, targets)
    expect(mappings).toHaveLength(1)
    expect(mappings[0]?.propertyName).toBe('title')
  })

  it('does not map author string onto List of Relation authors', () => {
    const sources: SourceNode[] = [
      {
        id: 'rss-author',
        label: 'author',
        kind: 'rssField',
        value: 'Jane Doe',
      },
      {
        id: 'rss-title',
        label: 'title',
        kind: 'rssField',
        value: 'Hello',
      },
    ]
    const targets: TargetProperty[] = [
      {
        name: 'authors',
        dataType: 'List',
        refValueType: 'Relation',
        ref: 'Identity',
      },
      { name: 'title', dataType: 'String' },
      { name: 'byline', dataType: 'String' },
    ]
    const mappings = autoMap(sources, targets)
    expect(mappings.find((m) => m.propertyName === 'authors')).toBeUndefined()
    expect(mappings.find((m) => m.propertyName === 'title')).toEqual({
      sourceId: 'rss-title',
      propertyName: 'title',
    })
    // author may map to byline (string) via alias
    expect(mappings.find((m) => m.propertyName === 'byline')).toEqual({
      sourceId: 'rss-author',
      propertyName: 'byline',
    })
  })
})
