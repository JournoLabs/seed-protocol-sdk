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
})
