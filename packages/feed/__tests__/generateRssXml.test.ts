import { describe, it, expect } from 'vitest'
import { generateRssXml } from '../src/rss/generateRssXml'

describe('generateRssXml', () => {
  it('emits namespaced author nested fields for expanded authors array', () => {
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

    expect(xml).toContain('xmlns:author="https://seedprotocol.io/ns/relations/author/1.0"')
    expect(xml).toContain('<author>')
    expect(xml).toContain('<author:displayName>Test User 1</author:displayName>')
    expect(xml).toContain('<author:displayName>Test User 2</author:displayName>')
  })

  it('auto-discovers and namespaces nested objects under expanded relations', () => {
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

    expect(xml).toContain('xmlns:coauthor="https://seedprotocol.io/ns/relations/coAuthor/1.0"')
    expect(xml).toContain('<coAuthor>')
    expect(xml).toContain('<coauthor:profile>')
    expect(xml).toContain('<coauthor:bio>Hello</coauthor:bio>')
  })

  it('emits namespaced nested fields for publication relation objects', () => {
    const xml = generateRssXml({
      title: 'T',
      link: 'https://example.com',
      description: 'D',
      items: [
        {
          title: 'Post',
          link: 'https://example.com/p/1',
          publication: {
            title: "My Publication's Title",
            editors: [{ name: 'Editor One' }],
          },
        },
      ],
    })

    expect(xml).toContain('xmlns:publication="https://seedprotocol.io/ns/publication/1.0"')
    expect(xml).toContain('<publication>')
    expect(xml).toContain("<publication:title>My Publication's Title</publication:title>")
    expect(xml).toContain('<publication:editor>')
    expect(xml).toContain('<publication:name>Editor One</publication:name>')
  })

  it('auto-namespaces non-curated relation fields on first use', () => {
    const xml = generateRssXml({
      title: 'T',
      link: 'https://example.com',
      description: 'D',
      items: [
        {
          title: 'Post',
          link: 'https://example.com/p/1',
          organization: {
            name: 'Acme',
          },
        },
      ],
    })

    expect(xml).toContain('xmlns:organization="https://seedprotocol.io/ns/relations/organization/1.0"')
    expect(xml).toContain('<organization>')
    expect(xml).toContain('<organization:name>Acme</organization:name>')
  })

  it('uses deterministic fallback prefix for reserved XML prefixes', () => {
    const xml = generateRssXml({
      title: 'T',
      link: 'https://example.com',
      description: 'D',
      items: [
        {
          title: 'Post',
          link: 'https://example.com/p/1',
          xml: {
            name: 'Reserved',
          },
        },
      ],
    })

    expect(xml).toContain('xmlns:xml2="https://seedprotocol.io/ns/relations/xml/1.0"')
    expect(xml).toContain('<xml>')
    expect(xml).toContain('<xml2:name>Reserved</xml2:name>')
  })
})
