import { describe, expect, it } from 'vitest'
import { createFeed } from '../src/index'

const post = {
  id: '0xseed1',
  seedUid: '0xseed1',
  guid: 'urn:example:post-1',
  title: 'Post 1',
  link: 'https://example.com/posts/1',
  pubDate: 'Tue, 21 Oct 2026 12:00:00 GMT',
}

describe('createFeed item ids', () => {
  it('uses the RSS guid as the Atom entry id', async () => {
    const xml = await createFeed([post as any], 'post', 'atom')
    expect(xml).toContain('<id>urn:example:post-1</id>')
    expect(xml).not.toContain('<id>0xseed1</id>')
  })

  it('keeps the default <updated> and links for a null item field', async () => {
    const xml = await createFeed([{ ...post, updated: null, links: null } as any], 'post', 'atom')
    const entry = xml.slice(xml.indexOf('<entry>'))
    expect(entry).toContain('<updated>')
    expect(entry).toContain('href="https://example.com/posts/1"')
  })

  it('uses the RSS guid as the JSON Feed item id', async () => {
    const json = JSON.parse(await createFeed([post as any], 'post', 'json'))
    expect(json.items[0].id).toBe('urn:example:post-1')
  })

  it('uses the link as the id in all three formats when the item has no guid', async () => {
    const { guid: _guid, ...noGuid } = post
    const rss = await createFeed([noGuid as any], 'post', 'rss')
    const atom = await createFeed([noGuid as any], 'post', 'atom')
    const json = JSON.parse(await createFeed([noGuid as any], 'post', 'json'))
    expect(rss).toContain('https://example.com/posts/1</guid>')
    expect(atom).toContain('<id>https://example.com/posts/1</id>')
    expect(json.items[0].id).toBe('https://example.com/posts/1')
  })

  it('keeps an item\'s own Atom updated and links', async () => {
    const own = {
      ...post,
      updated: '2026-10-01T00:00:00.000Z',
      links: [{ href: 'https://example.com/elsewhere/1' }],
    }
    const atom = await createFeed([own as any], 'post', 'atom')
    expect(atom).toContain('<updated>2026-10-01T00:00:00.000Z</updated>')
    expect(atom).toContain('href="https://example.com/elsewhere/1"')
    expect(atom).not.toContain('href="https://example.com/posts/1"')
  })

  it('marks an ar:// guid as not a permalink in RSS', async () => {
    const rss = await createFeed([{ ...post, guid: 'ar://feedTx' } as any], 'post', 'rss')
    expect(rss).toContain('<guid isPermaLink="false">ar://feedTx</guid>')
  })
})

