import { describe, it, expect } from 'vitest'
import {
  needsMetadataIdSuffix,
  toMetadataPropertyName,
  getMetadataPropertyNamesForQuery,
  toSchemaPropertyName,
  getAlternatePropertyNameForInstanceLookup,
  resolveMetadataRecord,
  resolveStorageNameToSchemaName,
  listRelationStoragePropertyName,
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
    it('returns [base, baseId, baseIds] for metadata types', () => {
      expect(getMetadataPropertyNamesForQuery('avatarImage', 'Image')).toEqual([
        'avatarImage',
        'avatarImageId',
        'avatarImageIds',
      ])
      expect(getMetadataPropertyNamesForQuery('html', 'Html')).toEqual([
        'html',
        'htmlId',
        'htmlIds',
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
        'avatarImageIds',
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

  describe('listRelationStoragePropertyName / resolveStorageNameToSchemaName', () => {
    const postSchemas = {
      authors: { dataType: 'List', ref: 'Identity' },
      title: { dataType: 'Text' },
    }

    it('maps schema key to storage name (singular + ref + Ids)', () => {
      expect(listRelationStoragePropertyName(postSchemas, 'authors')).toBe('authorIdentityIds')
    })

    it('returns undefined for non-List properties', () => {
      expect(listRelationStoragePropertyName(postSchemas, 'title')).toBeUndefined()
    })

    it('maps storage name back to schema key', () => {
      expect(resolveStorageNameToSchemaName(postSchemas, 'authorIdentityIds')).toBe('authors')
    })

    it('returns undefined when no List matches storage name', () => {
      expect(resolveStorageNameToSchemaName(postSchemas, 'tagTagIds')).toBeUndefined()
    })

    it('supports refModelName on schema def', () => {
      const schemas = {
        contributors: { dataType: 'List', refModelName: 'Identity' },
      }
      expect(listRelationStoragePropertyName(schemas, 'contributors')).toBe('contributorIdentityIds')
      expect(resolveStorageNameToSchemaName(schemas, 'contributorIdentityIds')).toBe('contributors')
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
