import { describe, it, expect } from 'vitest'
import { invalidNameMatchValues, nameMatchLevelsFromRows } from '@/db/read/nameMatchLevels'

/** ADR 0009: a property's nameMatch, else its model's, else the schema's, else fuzzy. */
describe('nameMatchLevelsFromRows', () => {
  const file = (data: object) => JSON.stringify(data)
  const strict = file({
    nameMatch: 'normalized',
    models: {
      Post: {
        id: 'post-strict',
        nameMatch: 'exact',
        properties: { title: { type: 'Text' }, tags: { type: 'List', nameMatch: 'fuzzy' } },
      },
      Comment: { id: 'comment-strict', properties: { body: { type: 'Text' } } },
    },
  })
  const loose = file({
    models: {
      Post: { id: 'post-loose', properties: { title: { type: 'Text' } } },
      Note: { id: 'note-loose', properties: { body: { type: 'Text', nameMatch: 'bogus' } } },
    },
  })
  const levels = nameMatchLevelsFromRows([
    { modelName: 'Post', modelFileId: 'post-strict', schemaData: strict },
    { modelName: 'Comment', modelFileId: 'comment-strict', schemaData: strict },
    { modelName: 'Post', modelFileId: 'post-loose', schemaData: loose },
    { modelName: 'Note', modelFileId: 'note-loose', schemaData: loose },
    { modelName: 'Orphan', modelFileId: 'orphan', schemaData: null },
  ])

  it('takes the property, then the model, then the schema, then fuzzy', () => {
    expect(levels.property('Post', 'tags', 'post-strict')).toBe('fuzzy')
    expect(levels.property('Post', 'title', 'post-strict')).toBe('exact')
    expect(levels.property('Comment', 'body', 'comment-strict')).toBe('normalized')
    expect(levels.property('Post', 'title', 'post-loose')).toBe('fuzzy')
    expect(levels.model('Comment')).toBe('normalized')
  })

  it('uses the tightest level when several schemas define the model and none is named', () => {
    expect(levels.model('Post')).toBe('exact')
    expect(levels.property('Post', 'title')).toBe('exact')
  })

  it('ignores invalid values and unknown models', () => {
    expect(levels.property('Note', 'body', 'note-loose')).toBe('fuzzy')
    expect(levels.model('Orphan')).toBe('fuzzy')
    expect(levels.model('Unknown')).toBe('fuzzy')
    expect(levels.property('Post', 'addedInApp', 'post-strict')).toBe('exact')
  })
})

describe('invalidNameMatchValues', () => {
  it('lists every nameMatch that is not a level', () => {
    expect(
      invalidNameMatchValues({
        nameMatch: 'strict',
        models: {
          Post: { nameMatch: 'exact', properties: { title: { nameMatch: 'Exact' }, body: {} } },
          Tag: { nameMatch: 3, properties: {} },
        },
      }),
    ).toEqual([
      `schema nameMatch "strict" is not 'exact', 'normalized' or 'fuzzy'`,
      `Post.title nameMatch "Exact" is not 'exact', 'normalized' or 'fuzzy'`,
      `Tag nameMatch 3 is not 'exact', 'normalized' or 'fuzzy'`,
    ])
  })
})
