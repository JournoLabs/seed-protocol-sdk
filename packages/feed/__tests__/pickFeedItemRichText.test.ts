import { describe, it, expect } from 'vitest'
import {
  pickFeedItemContent,
  pickFeedItemDescription,
  feedItemRichTextContainsDataUriImage,
  filterItemsByRichTextDataUriImagePolicy,
} from '../src/pickFeedItemRichText'
import { generateRssXml } from '../src/rss/generateRssXml'

describe('pickFeedItemRichText', () => {
  it('pickFeedItemDescription prefers summary over description and text', () => {
    expect(
      pickFeedItemDescription({
        summary: 'S',
        description: 'D',
        text: 'T',
      })
    ).toBe('S')
  })

  it('pickFeedItemContent prefers body over summary when both exist', () => {
    expect(
      pickFeedItemContent({
        summary: 'Short',
        body: '<p>Full</p>',
      })
    ).toBe('<p>Full</p>')
  })

  it('pickFeedItemContent uses html before body when both exist', () => {
    expect(
      pickFeedItemContent({
        html: '<div>a</div>',
        body: '<p>b</p>',
      })
    ).toBe('<div>a</div>')
  })

  it('pickFeedItemContent falls back to summary when no html body keys', () => {
    expect(pickFeedItemContent({ summary: 'Plain only' })).toBe('Plain only')
  })

  it('pickFeedItemContent reads capitalized Html and Body', () => {
    expect(pickFeedItemContent({ Html: '<p>x</p>' })).toBe('<p>x</p>')
    expect(pickFeedItemContent({ Body: '<article>y</article>' })).toBe('<article>y</article>')
  })

  it('pickFeedItemDescription does not use body as excerpt', () => {
    expect(
      pickFeedItemDescription({
        body: '<p>HTML</p>',
      })
    ).toBe('')
  })

  it('maps body-only item to RSS content:encoded via content', () => {
    const content = pickFeedItemContent({
      title: 'Post',
      body: '<p>Hello</p>',
    })
    const xml = generateRssXml({
      title: 'T',
      link: 'https://example.com',
      description: 'D',
      items: [
        {
          title: 'Post',
          link: 'https://example.com/p/1',
          content,
        },
      ],
    })
    expect(xml).toContain('content:encoded')
    expect(xml).toContain('<p>Hello</p>')
  })

  it('feedItemRichTextContainsDataUriImage is true for body with data URI image', () => {
    expect(
      feedItemRichTextContainsDataUriImage({
        body: '<img src="data:image/png;base64,AAAA"/>',
      })
    ).toBe(true)
  })

  it('feedItemRichTextContainsDataUriImage ignores data URI without base64 marker', () => {
    expect(
      feedItemRichTextContainsDataUriImage({
        body: '<img src="data:image/png,AAAA"/>',
      })
    ).toBe(false)
  })

  it('feedItemRichTextContainsDataUriImage checks description keys', () => {
    expect(
      feedItemRichTextContainsDataUriImage({
        description: 'x data:image/jpeg;base64,QQ== y',
      })
    ).toBe(true)
  })

  it('filterItemsByRichTextDataUriImagePolicy omits by default and keeps with include_items', () => {
    const items = [
      { id: '1', body: '<p>ok</p>' },
      { id: '2', body: '<img src="data:image/gif;base64,R0lGODlh"/>' },
    ]
    expect(filterItemsByRichTextDataUriImagePolicy(items, 'omit_items')).toHaveLength(1)
    expect(filterItemsByRichTextDataUriImagePolicy(items, 'omit_items')[0]!.id).toBe('1')
    expect(filterItemsByRichTextDataUriImagePolicy(items, 'include_items')).toHaveLength(2)
  })

  const txUrl = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'

  it('pickFeedItemContent prefers typed Html over untyped html when models say image vs html', () => {
    expect(
      pickFeedItemContent({
        html: txUrl,
        Html: '<article>main</article>',
        _feedFieldStorageModels: { html: 'image', Html: 'html' },
      })
    ).toBe('<article>main</article>')
  })

  it('pickFeedItemContent prefers typed json field over legacy body when json is rich', () => {
    expect(
      pickFeedItemContent({
        body: '<p>legacy</p>',
        structured: '{"x":1}',
        _feedFieldStorageModels: { structured: 'json' },
      })
    ).toBe('{"x":1}')
  })

  it('pickFeedItemContent picks first typed html in list after image slot', () => {
    expect(
      pickFeedItemContent({
        media: ['image-uid-placeholder', txUrl],
        _feedListElementStorageModels: {
          media: ['image', 'html'],
        },
      })
    ).toBe(txUrl)
  })

  it('feedItemRichTextContainsDataUriImage checks typed scalar fields', () => {
    expect(
      feedItemRichTextContainsDataUriImage({
        body: '<p>ok</p>',
        blob: '<img src="data:image/png;base64,QQ=="/>',
        _feedFieldStorageModels: { blob: 'html' },
      })
    ).toBe(true)
  })
})
