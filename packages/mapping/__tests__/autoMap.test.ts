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
    expect(mappings.find((m) => m.sourceId === 'rss-featureImage')?.propertyName).toBe(
      'featureImage',
    )
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
})
