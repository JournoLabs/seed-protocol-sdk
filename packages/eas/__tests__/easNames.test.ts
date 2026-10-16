import { describe, expect, it } from 'vitest'
import {
  easName,
  easNamesToFetch,
  easNameVariants,
  fuzzyNameKey,
  isNameMatchLevel,
  localNamesInBestMatchTier,
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

describe('nameMatch levels', () => {
  // [local name, EAS name, relation, the loosest level that accepts it (undefined: none)]
  const table: [string, string, boolean, 'exact' | 'normalized' | 'fuzzy' | undefined][] = [
    ['HTMLPage', 'html_page', false, 'exact'],
    ['HTMLPage', 'htmlpage', false, 'normalized'],
    ['HTMLPage', 'html-page', false, 'normalized'],
    ['title', 'Title', false, 'normalized'],
    ['post', 'posts', false, 'fuzzy'],
    ['author', 'author_id', true, 'fuzzy'],
    ['author', 'author_id', false, undefined],
    ['title', 'tile', false, undefined],
  ]
  const levels = ['exact', 'normalized', 'fuzzy'] as const

  it.each(table)('%s vs %s (relation %s) first matches at %s', (local, eas, relation, loosest) => {
    for (const level of levels) {
      const accepted = loosest !== undefined && levels.indexOf(level) >= levels.indexOf(loosest)
      const match = matchEasName(eas, [{ value: local, name: local, relation, level }])
      expect(match.kind, `${level}`).toBe(accepted ? 'match' : 'none')
      expect(localNamesInBestMatchTier(eas, [local], { relation, level }).size, `${level}`).toBe(accepted ? 1 : 0)
    }
  })

  it('takes a level per local name', () => {
    const level = (name: string) => (name === 'Post' ? 'exact' : 'fuzzy')
    expect([...localNamesInBestMatchTier('posts', ['Post', 'Comment'], { level })]).toEqual([])
    expect([...localNamesInBestMatchTier('comments', ['Post', 'Comment'], { level })]).toEqual(['Comment'])
  })

  it('isNameMatchLevel accepts only the three levels', () => {
    expect(['exact', 'normalized', 'fuzzy'].every(isNameMatchLevel)).toBe(true)
    expect([undefined, 'strict', 'Exact', 1].some(isNameMatchLevel)).toBe(false)
  })

  it('easNamesToFetch widens with the level', () => {
    expect(easNamesToFetch('HTMLPage', 'exact')).toEqual(['html_page'])
    const normalized = easNamesToFetch('HTMLPage', 'normalized')
    expect(normalized).toEqual(expect.arrayContaining(['html_page', 'htmlpage', 'HTMLPage']))
    expect(normalized).not.toContain('html_pages')
    expect(easNamesToFetch('HTMLPage', 'fuzzy')).toEqual(expect.arrayContaining([...normalized, 'html_pages', 'htmlpages']))
    expect(easNamesToFetch('HTMLPage')).toEqual(easNamesToFetch('HTMLPage', 'fuzzy'))
  })
})
