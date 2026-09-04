import { describe, it, expect } from 'vitest'
import { parseEasPropertyMetadata } from '../src/parseEasPropertyMetadata'
import { parseEasRelationPropertyName } from '../src/parseEasRelationPropertyName'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@seedprotocol/eas'

describe('parseEasPropertyMetadata', () => {
  it('parses valid decodedDataJson', () => {
    const raw = JSON.stringify([{ value: { name: 'title', value: 'Hello', type: 'string' } }])
    const result = parseEasPropertyMetadata(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.metadata.name).toBe('title')
      expect(result.metadata.value).toBe('Hello')
    }
  })

  it('rejects empty', () => {
    expect(parseEasPropertyMetadata('').ok).toBe(false)
    expect(parseEasPropertyMetadata(null).ok).toBe(false)
  })

  it('rejects bad shape', () => {
    expect(parseEasPropertyMetadata('{}').ok).toBe(false)
    expect(parseEasPropertyMetadata('[]').ok).toBe(false)
  })

  it('rejects invalid JSON', () => {
    const result = parseEasPropertyMetadata('{not-json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parse')
    }
  })
})

describe('parseEasRelationPropertyName', () => {
  it('parses singular relation', () => {
    expect(parseEasRelationPropertyName('cover_image_id')).toEqual({
      propertyName: 'covers',
      modelName: 'image',
      isList: false,
    })
  })

  it('parses list relation', () => {
    expect(parseEasRelationPropertyName('tag_tag_ids')).toEqual({
      propertyName: 'tags',
      modelName: 'tag',
      isList: true,
    })
  })

  it('returns null for non-relation shapes', () => {
    expect(parseEasRelationPropertyName('title')).toBeNull()
    expect(parseEasRelationPropertyName('')).toBeNull()
  })
})

describe('latestVersion canonical property pick (eas helper)', () => {
  it('keeps newest attestation per refUID+schemaId', () => {
    const out = pickLatestPropertyAttestationsByRefAndSchema([
      { refUID: 'v1', schemaId: 'sTitle', timeCreated: 10 },
      { refUID: 'v1', schemaId: 'sTitle', timeCreated: 20 },
      { refUID: 'v1', schemaId: 'sBody', timeCreated: 15 },
    ])
    expect(out).toHaveLength(2)
    expect(out.find((a) => a.schemaId === 'sTitle')?.timeCreated).toBe(20)
  })
})
