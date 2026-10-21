import { describe, expect, it, vi } from 'vitest'
import { easPropertyNameForPublish, easSchemaDefinitionForProperty } from '@/helpers/metadataPropertyNames'
import { warnOnEasNameCollisions } from '@/helpers/schemaApply'

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

describe('easSchemaDefinitionForProperty', () => {
  it.each([
    ['storageTransactionId', { dataType: 'Text' }, 'string storage_transaction_id'],
    ['featureImageId', { dataType: 'Image' }, 'bytes32 feature_image'],
    ['authors', { dataType: 'List', ref: 'Identity' }, 'bytes32[] author_identity_ids'],
    ['publishedOn', { dataType: 'Date' }, 'uint256 published_on'],
  ] as const)('%s %j → %s', (name, def, expected) => {
    expect(easSchemaDefinitionForProperty(name, def)).toBe(expected)
  })

  it('is undefined without a known data type', () => {
    expect(easSchemaDefinitionForProperty('title')).toBeUndefined()
    expect(easSchemaDefinitionForProperty('title', { dataType: 'Nope' })).toBeUndefined()
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
