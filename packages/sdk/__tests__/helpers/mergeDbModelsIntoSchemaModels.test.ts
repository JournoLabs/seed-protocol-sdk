import { describe, it, expect } from 'vitest'
import { mergeDbModelsIntoSchemaModels } from '@/helpers/db'

/**
 * Loading a schema merges the models read from the database into the schema file's. Fields only
 * the file holds (nameMatch, ADR 0009) must survive; they decide what saveNewVersion writes.
 */
describe('mergeDbModelsIntoSchemaModels', () => {
  const fileModels = {
    Post: {
      id: 'post-id',
      nameMatch: 'exact',
      description: 'A post',
      properties: {
        title: { id: 'title-id', type: 'Text', nameMatch: 'fuzzy', validation: { maxLength: 10 } },
        body: { id: 'body-id', type: 'Text' },
        author: { id: 'author-id', type: 'Relation', model: 'Person' },
      },
    },
  }

  it('keeps the file model and property fields the database does not store', () => {
    const merged = mergeDbModelsIntoSchemaModels(fileModels, {
      Post: {
        id: 'post-id',
        properties: {
          title: { dataType: 'Text', schemaFileId: 'title-id' },
          body: { dataType: 'Text', schemaFileId: 'body-id' },
          author: { dataType: 'Relation', schemaFileId: 'author-id', ref: 'Person' },
        },
      },
    })

    expect(merged.Post).toMatchObject({ id: 'post-id', nameMatch: 'exact', description: 'A post' })
    expect(merged.Post.properties.title).toEqual({
      id: 'title-id',
      nameMatch: 'fuzzy',
      validation: { maxLength: 10 },
      dataType: 'Text',
      schemaFileId: 'title-id',
    })
    expect(merged.Post.properties.author).toEqual({
      id: 'author-id',
      dataType: 'Relation',
      schemaFileId: 'author-id',
      ref: 'Person',
    })
  })

  it('moves a property renamed in the database to its new name, keeping its file fields', () => {
    const merged = mergeDbModelsIntoSchemaModels(fileModels, {
      Post: {
        id: 'post-id',
        properties: { headline: { dataType: 'Text', schemaFileId: 'title-id' } },
      },
    })

    expect(Object.keys(merged.Post.properties).sort()).toEqual(['author', 'body', 'headline'])
    expect(merged.Post.properties.headline).toMatchObject({ nameMatch: 'fuzzy', dataType: 'Text' })
  })

  it('does not take fields from a same-named property with another id', () => {
    const merged = mergeDbModelsIntoSchemaModels(fileModels, {
      Post: { id: 'post-id', properties: { title: { dataType: 'Number', schemaFileId: 'other-id' } } },
    })

    expect(merged.Post.properties.title).toEqual({ dataType: 'Number', schemaFileId: 'other-id' })
  })

  it('adds models only the database has', () => {
    const note = { id: 'note-id', properties: { text: { dataType: 'Text', schemaFileId: 'text-id' } } }
    const merged = mergeDbModelsIntoSchemaModels(fileModels, { Note: note })

    expect(merged.Note).toEqual(note)
    expect(merged.Post).toBe(fileModels.Post)
  })
})
