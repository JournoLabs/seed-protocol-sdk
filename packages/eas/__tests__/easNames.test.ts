import { describe, expect, it } from 'vitest'
import {
  easName,
  easNameVariants,
  fuzzyNameKey,
  matchEasName,
  nameMatchTier,
  normalizedNameKey,
} from '../src/easNames.js'

describe('easName', () => {
  it.each([
    ['HTMLPage', 'html_page'],
    ['ID3Tag', 'id3_tag'],
    ['imageV2', 'image_v2'],
    ['New model', 'new_model'],
    ['coverURL', 'cover_url'],
    ['published_at', 'published_at'],
    ['authorIdentityIds', 'author_identity_ids'],
    ['title', 'title'],
    ['Post', 'post'],
    ['blog-post', 'blog_post'],
    ['  spaced  out ', 'spaced_out'],
    ['storage_transaction_id', 'storage_transaction_id'],
  ])('%s → %s', (input, expected) => {
    expect(easName(input)).toBe(expected)
  })
})

describe('keys', () => {
  it('normalized drops case and separators', () => {
    expect(normalizedNameKey('html_page')).toBe(normalizedNameKey('HTMLPage'))
    expect(normalizedNameKey('html-page')).toBe('htmlpage')
  })

  it('fuzzy drops a plural s, and id/ids for relations only', () => {
    expect(fuzzyNameKey('posts')).toBe('post')
    expect(fuzzyNameKey('class')).toBe('class')
    expect(fuzzyNameKey('bus')).toBe('bus')
    expect(fuzzyNameKey('author_id', { relation: true })).toBe('author')
    expect(fuzzyNameKey('author_ids', { relation: true })).toBe('author')
    expect(fuzzyNameKey('author_id')).toBe('authorid')
  })
})

describe('nameMatchTier', () => {
  it.each([
    ['HTMLPage', 'html_page', {}, 'exact'],
    ['HTMLPage', 'htmlpage', {}, 'normalized'],
    ['coverURL', 'cover_url', {}, 'exact'],
    ['published_at', 'published_at', {}, 'exact'],
    ['post', 'posts', {}, 'fuzzy'],
    ['author', 'author_id', { relation: true }, 'fuzzy'],
    ['author', 'author_id', {}, undefined],
    ['title', 'tile', {}, undefined],
    ['title', 'subtitle', {}, undefined],
  ] as const)('%s vs %s %j → %s', (local, eas, options, tier) => {
    expect(nameMatchTier(local, eas, options)).toBe(tier)
  })
})

describe('matchEasName', () => {
  const candidates = [
    { value: 'title', name: 'title' },
    { value: 'Title', name: 'Title' },
    { value: 'posts', name: 'posts' },
    { value: 'author', name: 'author', relation: true },
  ]

  it('takes the tightest tier', () => {
    expect(matchEasName('post', [{ value: 'post', name: 'post' }, ...candidates])).toEqual({
      kind: 'match',
      value: 'post',
      tier: 'exact',
    })
    expect(matchEasName('author_id', candidates)).toEqual({ kind: 'match', value: 'author', tier: 'fuzzy' })
  })

  it('matches nothing on a tie in the best tier', () => {
    expect(matchEasName('title', candidates)).toEqual({ kind: 'ambiguous', values: ['title', 'Title'], tier: 'exact' })
  })

  it("respects each candidate's level", () => {
    const strict = [{ value: 'post', name: 'post', level: 'exact' as const }]
    expect(matchEasName('posts', strict)).toEqual({ kind: 'none' })
    expect(matchEasName('post', strict)).toEqual({ kind: 'match', value: 'post', tier: 'exact' })
    const normalized = [{ value: 'page', name: 'HTMLPage', level: 'normalized' as const }]
    expect(matchEasName('htmlpage', normalized)).toEqual({ kind: 'match', value: 'page', tier: 'normalized' })
    expect(matchEasName('htmlpages', normalized)).toEqual({ kind: 'none' })
  })
})

describe('easNameVariants', () => {
  it("includes the name and what older SDKs published", () => {
    expect(easNameVariants('HTMLPage')).toEqual(['html_page', 'htmlpage'])
    expect(easNameVariants('title')).toEqual(['title'])
  })
})
