import { describe, expect, it, vi } from 'vitest'
import { easPropertyNameForPublish } from '@/helpers/metadataPropertyNames'
import { warnOnEasNameCollisions } from '@/imports/json'

describe('easPropertyNameForPublish (ADR 0008)', () => {
  it.each([
    ['title', { dataType: 'Text' }, 'title'],
    ['coverURL', { dataType: 'Text' }, 'cover_url'],
    ['author', { dataType: 'Relation', ref: 'Identity' }, 'author'],
    ['authorId', { dataType: 'Relation', ref: 'Identity' }, 'author'],
    ['authorId', { dataType: 'Relation', ref: 'Identity', name: 'author' }, 'author'],
    ['featureImage', { dataType: 'Image' }, 'feature_image'],
    ['featureImageId', { dataType: 'Image' }, 'feature_image'],
    ['authors', { dataType: 'List', ref: 'Identity' }, 'author_identity_ids'],
    ['tags', { dataType: 'List' }, 'tags'],
    ['storageTransactionId', { dataType: 'Text' }, 'storage_transaction_id'],
  ] as const)('%s %j → %s', (name, def, expected) => {
    expect(easPropertyNameForPublish(name, def)).toBe(expected)
  })
})

describe('warnOnEasNameCollisions', () => {
  it('warns about models and properties that publish to the same EAS schema', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const warnings = warnOnEasNameCollisions({
        metadata: { name: 'collide' },
        models: {
          HTMLPage: {
            properties: {
              coverURL: { type: 'Text' },
              cover_url: { type: 'Text' },
              author: { type: 'Relation', ref: 'Writer' },
              title: { type: 'Text' },
            },
          },
          HtmlPage: { properties: {} },
          Writer: { properties: {} },
        },
      } as never)
      expect(warnings).toEqual([
        'models HTMLPage, HtmlPage all publish as "bytes32 html_page"',
        'HTMLPage properties coverURL, cover_url all publish as "cover_url"',
      ])
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })
})
