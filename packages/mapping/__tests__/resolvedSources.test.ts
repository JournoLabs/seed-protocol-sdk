import { describe, expect, it } from 'vitest'
import {
  buildResolvedSourceNodes,
  normalizeMappingFromSourceId,
  parseResolvedSourceId,
  resolvedSourceId,
} from '../src/resolvedSources'
import type { SourceNode } from '../src/types'

describe('resolvedSources', () => {
  const link: SourceNode = {
    id: 'rss-link',
    label: 'link',
    kind: 'rssField',
    value: 'https://example.com/p/1',
  }

  it('parses and builds derived ids', () => {
    expect(resolvedSourceId('rss-link', 'extract')).toBe('rss-link@extract')
    expect(parseResolvedSourceId('rss-link@file')).toEqual({
      originId: 'rss-link',
      resolve: 'file',
    })
    expect(parseResolvedSourceId('rss-link')).toBeNull()
  })

  it('normalizes derived source ids to FieldMapping with resolve', () => {
    expect(normalizeMappingFromSourceId('rss-link@extract', 'html')).toEqual({
      sourceId: 'rss-link',
      propertyName: 'html',
      resolve: 'extract',
    })
    expect(normalizeMappingFromSourceId('rss-title', 'title')).toEqual({
      sourceId: 'rss-title',
      propertyName: 'title',
    })
  })

  it('buildResolvedSourceNodes adds extract and file candidates', () => {
    const expanded = buildResolvedSourceNodes([link])
    expect(expanded).toHaveLength(3)
    const extract = expanded.find((s) => s.id === 'rss-link@extract')
    const file = expanded.find((s) => s.id === 'rss-link@file')
    expect(extract?.kind).toBe('resolved')
    expect(extract?.meta?.resolve).toBe('extract')
    expect(extract?.meta?.originId).toBe('rss-link')
    expect(file?.meta?.resolve).toBe('file')
    expect(file?.value).toBe('https://example.com/p/1')
  })

  it('does not duplicate when already expanded', () => {
    const once = buildResolvedSourceNodes([link])
    const twice = buildResolvedSourceNodes(once)
    expect(twice.filter((s) => s.kind === 'resolved')).toHaveLength(2)
  })
})
