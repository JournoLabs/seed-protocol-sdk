import { describe, expect, it } from 'vitest'
import {
  REGISTRY_PATH,
  feedDrivePath,
  feedHttpPath,
  hyperFeedUrl,
  resolveHttpToDrivePath,
} from '../src/paths'

describe('feed-hyper paths', () => {
  it('maps schema/format to drive paths with extensions', () => {
    expect(feedDrivePath('post', 'rss')).toBe('/posts/rss.xml')
    expect(feedDrivePath('post', 'atom')).toBe('/posts/atom.xml')
    expect(feedDrivePath('post', 'json')).toBe('/posts/feed.json')
    expect(feedDrivePath('identity', 'rss')).toBe('/identities/rss.xml')
  })

  it('maps archive paths', () => {
    expect(feedDrivePath('post', 'rss', { year: 2024, month: 2 })).toBe(
      '/posts/archive/2024/2/rss.xml',
    )
  })

  it('maps HTTP-style paths without extensions', () => {
    expect(feedHttpPath('post', 'rss')).toBe('/posts/rss')
  })

  it('resolves both HTTP and drive path shapes to drive files', () => {
    expect(resolveHttpToDrivePath('/posts/rss')).toBe('/posts/rss.xml')
    expect(resolveHttpToDrivePath('/posts/atom')).toBe('/posts/atom.xml')
    expect(resolveHttpToDrivePath('/posts/json')).toBe('/posts/feed.json')
    expect(resolveHttpToDrivePath('/posts/rss.xml')).toBe('/posts/rss.xml')
    expect(resolveHttpToDrivePath('/posts/feed.json')).toBe('/posts/feed.json')
    expect(resolveHttpToDrivePath('/posts/archive/2024/2/rss')).toBe(
      '/posts/archive/2024/2/rss.xml',
    )
    expect(resolveHttpToDrivePath('/posts/archive/2024/2/json')).toBe(
      '/posts/archive/2024/2/feed.json',
    )
    expect(resolveHttpToDrivePath('/registry.json')).toBe('/registry.json')
    expect(resolveHttpToDrivePath('/posts/')).toBe('/posts')
  })

  it('builds hyper URLs and registry path', () => {
    expect(hyperFeedUrl('abc')).toBe('hyper://abc')
    expect(REGISTRY_PATH).toBe('/registry.json')
  })
})
