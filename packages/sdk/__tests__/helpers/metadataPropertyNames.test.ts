import { describe, it, expect } from 'vitest'
import {
  needsMetadataIdSuffix,
  toMetadataPropertyName,
  getMetadataPropertyNamesForQuery,
  toSchemaPropertyName,
  getAlternatePropertyNameForInstanceLookup,
  resolveMetadataRecord,
  listRelationEasPropertyName,
  metadataStorageName,
  metadataStoredNameForms,
  propertyKeyFromStoredName,
  metadataRowPropertyKey,
} from '@/helpers/metadataPropertyNames'

describe('metadataPropertyNames', () => {
  describe('needsMetadataIdSuffix', () => {
    it('returns true for Image, File, Html, Relation', () => {
      expect(needsMetadataIdSuffix('Image')).toBe(true)
      expect(needsMetadataIdSuffix('File')).toBe(true)
      expect(needsMetadataIdSuffix('Html')).toBe(true)
      expect(needsMetadataIdSuffix('Relation')).toBe(true)
    })

    it('returns true when refValueType is metadata type', () => {
      expect(needsMetadataIdSuffix('Text', 'Image')).toBe(true)
      expect(needsMetadataIdSuffix(undefined, 'File')).toBe(true)
    })

    it('returns false for Text and other types', () => {
      expect(needsMetadataIdSuffix('Text')).toBe(false)
      expect(needsMetadataIdSuffix('String')).toBe(false)
      expect(needsMetadataIdSuffix()).toBe(false)
    })
  })

  describe('toMetadataPropertyName', () => {
    it('adds Id suffix for Image/File/Html/Relation types', () => {
      expect(toMetadataPropertyName('avatarImage', 'Image')).toBe('avatarImageId')
      expect(toMetadataPropertyName('avatarImage', 'File')).toBe('avatarImageId')
      expect(toMetadataPropertyName('html', 'Html')).toBe('htmlId')
      expect(toMetadataPropertyName('author', 'Relation')).toBe('authorId')
    })

    it('leaves name unchanged when already ends with Id', () => {
      expect(toMetadataPropertyName('avatarImageId', 'Image')).toBe('avatarImageId')
      expect(toMetadataPropertyName('htmlId', 'Html')).toBe('htmlId')
    })

    it('leaves name unchanged when already ends with Ids', () => {
      expect(toMetadataPropertyName('authorsIds', 'Relation')).toBe('authorsIds')
    })

    it('excludes storageTransactionId and transactionId', () => {
      expect(toMetadataPropertyName('storageTransactionId')).toBe('storageTransactionId')
      expect(toMetadataPropertyName('transactionId')).toBe('transactionId')
    })

    it('returns bare name for non-metadata types', () => {
      expect(toMetadataPropertyName('title', 'Text')).toBe('title')
      expect(toMetadataPropertyName('name', 'String')).toBe('name')
    })
  })

  describe('getMetadataPropertyNamesForQuery', () => {
    it('returns [base, baseId] for metadata types', () => {
      expect(getMetadataPropertyNamesForQuery('avatarImage', 'Image')).toEqual([
        'avatarImage',
        'avatarImageId',
      ])
      expect(getMetadataPropertyNamesForQuery('html', 'Html')).toEqual([
        'html',
        'htmlId',
      ])
    })

    it('returns [name, nameId] when name ends with Id', () => {
      expect(getMetadataPropertyNamesForQuery('avatarImageId', 'Image')).toEqual([
        'avatarImageId',
        'avatarImage',
      ])
    })

    it('returns [name] when name ends with Ids', () => {
      expect(getMetadataPropertyNamesForQuery('authorsIds', 'Relation')).toEqual(['authorsIds'])
    })

    it('returns single name for non-metadata types', () => {
      expect(getMetadataPropertyNamesForQuery('title', 'Text')).toEqual(['title'])
    })

    it('returns all variants when dataType is undefined (backwards compat)', () => {
      expect(getMetadataPropertyNamesForQuery('avatarImage')).toEqual([
        'avatarImage',
        'avatarImageId',
      ])
    })
  })

  describe('toSchemaPropertyName', () => {
    it('strips Id suffix', () => {
      expect(toSchemaPropertyName('avatarImageId')).toBe('avatarImage')
      expect(toSchemaPropertyName('htmlId')).toBe('html')
    })

    it('strips Ids suffix', () => {
      expect(toSchemaPropertyName('authorsIds')).toBe('authors')
    })

    it('returns undefined when no Id/Ids suffix', () => {
      expect(toSchemaPropertyName('title')).toBeUndefined()
      expect(toSchemaPropertyName('avatarImage')).toBeUndefined()
    })
  })

  describe('getAlternatePropertyNameForInstanceLookup', () => {
    it('returns base when name ends with Id', () => {
      expect(getAlternatePropertyNameForInstanceLookup('htmlId')).toBe('html')
      expect(getAlternatePropertyNameForInstanceLookup('avatarImageId')).toBe('avatarImage')
    })

    it('returns name+Id when name does not end with Id', () => {
      expect(getAlternatePropertyNameForInstanceLookup('html')).toBe('htmlId')
      expect(getAlternatePropertyNameForInstanceLookup('avatarImage')).toBe('avatarImageId')
    })

    it('returns undefined for excluded names', () => {
      expect(getAlternatePropertyNameForInstanceLookup('storageTransactionId')).toBeUndefined()
      expect(getAlternatePropertyNameForInstanceLookup('transactionId')).toBeUndefined()
    })
  })

  describe('storage-name codec (decision D4)', () => {
    const postSchemas = {
      authors: { dataType: 'List', ref: 'Identity' },
      contributors: { dataType: 'List', refModelName: 'Identity' },
      editor: { dataType: 'Relation', ref: 'Identity' },
      cover: { dataType: 'Image' },
      tags: { dataType: 'List', refValueType: 'Text' },
      title: { dataType: 'Text' },
    }

    it('writes each property under one storage name', () => {
      expect(metadataStorageName('authors', postSchemas.authors)).toBe('authorIdentityIds')
      expect(metadataStorageName('contributors', postSchemas.contributors)).toBe('contributorIdentityIds')
      expect(metadataStorageName('editor', postSchemas.editor)).toBe('editorId')
      expect(metadataStorageName('cover', postSchemas.cover)).toBe('coverId')
      expect(metadataStorageName('tags', postSchemas.tags)).toBe('tags')
      expect(metadataStorageName('title', postSchemas.title)).toBe('title')
      expect(metadataStorageName('storageTransactionId', { dataType: 'Text' })).toBe('storageTransactionId')
    })

    it('lists the names older writers and sync stored a property under', () => {
      expect(metadataStoredNameForms('authors', postSchemas.authors)).toEqual(['authorIdentityIds', 'authors'])
      expect(metadataStoredNameForms('photos', { dataType: 'List', refValueType: 'Image' })).toEqual(['photos', 'photosId'])
      expect(metadataStoredNameForms('editor', postSchemas.editor)).toEqual(['editorId', 'editor'])
      expect(metadataStoredNameForms('title', postSchemas.title)).toEqual(['title'])
    })

    it('maps every stored form back to one key', () => {
      expect(propertyKeyFromStoredName(postSchemas, 'authorIdentityIds')).toBe('authors')
      expect(propertyKeyFromStoredName(postSchemas, 'authors')).toBe('authors')
      expect(propertyKeyFromStoredName(postSchemas, 'contributorIdentityIds')).toBe('contributors')
      expect(propertyKeyFromStoredName(postSchemas, 'editorId')).toBe('editor')
      expect(propertyKeyFromStoredName(postSchemas, 'coverId')).toBe('cover')
      expect(propertyKeyFromStoredName(postSchemas, 'tagTagIds')).toBeUndefined()
      expect(propertyKeyFromStoredName(postSchemas, 'titleId')).toBeUndefined()
    })

    it('takes a row key from property_id first, then from its stored name', () => {
      expect(metadataRowPropertyKey({ propertyKey: 'heading', propertyName: 'title' }, postSchemas)).toBe('heading')
      expect(metadataRowPropertyKey({ propertyName: 'authorIdentityIds' }, postSchemas)).toBe('authors')
      expect(metadataRowPropertyKey({ propertyName: 'avatarId', refSeedType: 'image' })).toBe('avatar')
      expect(metadataRowPropertyKey({ propertyName: 'avatarId' })).toBe('avatarId')
      expect(metadataRowPropertyKey({ propertyName: 'storageTransactionId', refSeedType: 'file' })).toBe('storageTransactionId')
    })
  })

  describe('listRelationEasPropertyName', () => {
    const identityList = { dataType: 'List', ref: 'Identity' }

    it('derives the storage name from the schema key', () => {
      expect(listRelationEasPropertyName('authors', identityList)).toBe('authorIdentityIds')
      expect(listRelationEasPropertyName('admins', identityList)).toBe('adminIdentityIds')
      expect(listRelationEasPropertyName('staff', identityList)).toBe('staffIdentityIds')
    })

    it('returns a name already in storage form unchanged', () => {
      expect(listRelationEasPropertyName('staffIdentityIds', identityList)).toBe('staffIdentityIds')
      expect(listRelationEasPropertyName('authorIdentityIds', identityList)).toBe('authorIdentityIds')
    })

    it('accepts lowercase dataType and refModelName', () => {
      expect(listRelationEasPropertyName('staff', { dataType: 'list', refModelName: 'Identity' })).toBe(
        'staffIdentityIds',
      )
    })

    it('returns undefined for anything but a List of Relation', () => {
      expect(listRelationEasPropertyName('tags', { dataType: 'List' })).toBeUndefined()
      expect(listRelationEasPropertyName('title', { dataType: 'Text' })).toBeUndefined()
      expect(listRelationEasPropertyName('staff', undefined)).toBeUndefined()
    })
  })

  describe('resolveMetadataRecord', () => {
    it('returns single record when only one exists', () => {
      const records = [{ propertyName: 'avatarImageId', refResolvedValue: 'file.png' }]
      expect(resolveMetadataRecord(records, 'avatarImage', 'Image')).toEqual(records[0])
    })

    it('throws when no records', () => {
      expect(() => resolveMetadataRecord([], 'avatarImage')).toThrow('No records to resolve')
    })

    it('prefers record with refResolvedValue for metadata types', () => {
      const base = { propertyName: 'avatarImage', refResolvedValue: null }
      const idVariant = { propertyName: 'avatarImageId', refResolvedValue: 'avatar.png' }
      expect(resolveMetadataRecord([base, idVariant], 'avatarImage', 'Image')).toEqual(idVariant)
    })

    it('prefers record with refSeedType image/file/html', () => {
      const base = { propertyName: 'avatarImage', refSeedType: 'text' }
      const idVariant = { propertyName: 'avatarImageId', refSeedType: 'image' }
      expect(resolveMetadataRecord([base, idVariant], 'avatarImage', 'Image')).toEqual(idVariant)
    })

    it('prefers exact propertyName match as fallback', () => {
      const base = { propertyName: 'avatarImage' }
      const idVariant = { propertyName: 'avatarImageId' }
      expect(resolveMetadataRecord([idVariant, base], 'avatarImage', 'Image')).toEqual(base)
    })

    it('returns first record when no preference applies', () => {
      const a = { propertyName: 'avatarImage' }
      const b = { propertyName: 'avatarImageId' }
      expect(resolveMetadataRecord([a, b], 'other')).toEqual(a)
    })
  })
})
