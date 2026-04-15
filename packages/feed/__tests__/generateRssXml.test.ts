import { describe, it, expect } from 'vitest'
import { generateRssXml } from '../src/rss/generateRssXml'

describe('generateRssXml', () => {
  it('emits author elements with nested fields for expanded authors array', () => {
    const xml = generateRssXml({
      title: 'T',
      link: 'https://example.com',
      description: 'D',
      items: [
        {
          title: 'Post',
          link: 'https://example.com/p/1',
          authors: [{ displayName: 'Test User 1' }, { displayName: 'Test User 2' }],
        },
      ],
    })
    expect(xml).toContain('<author>')
    expect(xml).toContain('<displayName>Test User 1</displayName>')
    expect(xml).toContain('<displayName>Test User 2</displayName>')
  })

  it('serializes nested objects under expanded relations', () => {
    const xml = generateRssXml({
      title: 'T',
      link: 'https://example.com',
      description: 'D',
      items: [
        {
          title: 'Post',
          link: 'https://example.com/p/1',
          coAuthors: [
            {
              name: 'Nested',
              profile: { bio: 'Hello' },
            },
          ],
        },
      ],
    })
    expect(xml).toContain('<coAuthor>')
    expect(xml).toContain('<profile>')
    expect(xml).toContain('<bio>Hello</bio>')
  })
})
