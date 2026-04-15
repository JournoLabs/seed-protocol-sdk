import { describe, it, expect } from 'vitest'
import {
  publicListRelationPropertyKey,
  stripListRelationStorageAliasesForPublicKey,
  tryCoerceJsonStringArray,
} from '../src/listRelationKey'

describe('publicListRelationPropertyKey', () => {
  it('maps camelCase list storage names to plural schema keys', () => {
    expect(publicListRelationPropertyKey('authorIdentityIds')).toBe('authors')
    expect(publicListRelationPropertyKey('tagFooIds')).toBe('tags')
  })

  it('maps snake_case *_ids names using the first segment', () => {
    expect(publicListRelationPropertyKey('author_identity_ids')).toBe('authors')
  })

  it('leaves non-storage keys unchanged', () => {
    expect(publicListRelationPropertyKey('authors')).toBe('authors')
    expect(publicListRelationPropertyKey('title')).toBe('title')
    expect(publicListRelationPropertyKey('storage_transaction_id')).toBe('storage_transaction_id')
  })
})

describe('stripListRelationStorageAliasesForPublicKey', () => {
  it('removes storage aliases that resolve to the same public key', () => {
    const item: Record<string, unknown> = {
      authors: [{ displayName: 'A' }],
      authorIdentityIds: ['0x1'],
      author_identity_ids: ['0x2'],
      title: 'x',
    }
    stripListRelationStorageAliasesForPublicKey(item, 'authors')
    expect(item.authors).toEqual([{ displayName: 'A' }])
    expect(item.authorIdentityIds).toBeUndefined()
    expect(item.author_identity_ids).toBeUndefined()
    expect(item.title).toBe('x')
  })
})

describe('tryCoerceJsonStringArray', () => {
  it('parses JSON array strings', () => {
    expect(tryCoerceJsonStringArray('["a","b"]')).toEqual(['a', 'b'])
  })

  it('returns arrays and other values unchanged', () => {
    expect(tryCoerceJsonStringArray(['a'])).toEqual(['a'])
    expect(tryCoerceJsonStringArray('plain')).toBe('plain')
  })
})
