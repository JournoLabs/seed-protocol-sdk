import { afterEach, describe, expect, it } from 'vitest'
import {
  createFeed,
  DEFAULT_SITE_CONFIG,
  getSiteConfig,
  resetSiteConfig,
  setSiteConfig,
} from '../src/index'

describe('site config', () => {
  afterEach(() => {
    resetSiteConfig()
  })

  it('defaults to Seed Protocol hardcoded values', () => {
    expect(getSiteConfig()).toEqual(DEFAULT_SITE_CONFIG)
  })

  it('setSiteConfig merges partial overrides onto defaults', () => {
    setSiteConfig({
      title: 'My Publication',
      siteUrl: 'https://example.com',
      author: { name: 'Editor' },
    })

    expect(getSiteConfig()).toEqual({
      ...DEFAULT_SITE_CONFIG,
      title: 'My Publication',
      siteUrl: 'https://example.com',
      author: {
        ...DEFAULT_SITE_CONFIG.author!,
        name: 'Editor',
      },
    })
  })

  it('createFeed uses per-call siteConfig overrides', async () => {
    const xml = await createFeed(
      [{ id: '1', title: 'Hello', description: 'World' }],
      'post',
      'rss',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        title: 'Custom Feed',
        siteUrl: 'https://custom.example',
        description: 'Custom description',
      },
    )

    expect(xml).toContain('<title>Custom Feed - Posts</title>')
    expect(xml).toContain('<link>https://custom.example</link>')
    expect(xml).toContain('<description>Custom description</description>')
    expect(getSiteConfig()).toEqual(DEFAULT_SITE_CONFIG)
  })

  it('createFeed uses feedUrl for document self-links and siteUrl for channel link', async () => {
    const xml = await createFeed(
      [{ id: '1', title: 'Hello', description: 'World' }],
      'post',
      'atom',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        title: 'Custom Feed',
        siteUrl: 'https://custom.example',
        feedUrl: 'hyper://abcd1234',
        description: 'Custom description',
      },
    )

    expect(xml).toContain('https://custom.example')
    expect(xml).toContain('hyper://abcd1234/posts/atom')
  })
})
