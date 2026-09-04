import { describe, it, expect } from 'vitest'
import {
  parseEasPropertyMetadata,
  parseEasRelationPropertyName,
} from '@seedprotocol/query'
import { pickLatestPropertyAttestationsByRefAndSchema } from '@/helpers/easPropertyCanonical'

/**
 * Contracts used by syncDbWithEas / saveDataToDb after Phase 5:
 * shared decode + relation parse from @seedprotocol/query, and pickLatest
 * on both main and related-seed property write paths.
 */
describe('sync canonical helpers (shared with @seedprotocol/query)', () => {
  it('parseEasPropertyMetadata matches sync empty/malformed/ok guards', () => {
    expect(parseEasPropertyMetadata('').ok).toBe(false)
    expect(parseEasPropertyMetadata('   ').ok).toBe(false)
    expect(parseEasPropertyMetadata(null).ok).toBe(false)
    expect(parseEasPropertyMetadata('{}').ok).toBe(false)
    expect(parseEasPropertyMetadata('not-json').ok).toBe(false)

    const ok = parseEasPropertyMetadata(
      JSON.stringify([
        { value: { name: 'title', value: 'Hello', type: 'string' } },
      ]),
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.metadata.name).toBe('title')
      expect(ok.metadata.value).toBe('Hello')
    }
  })

  it('parseEasRelationPropertyName is re-exported for sync relation naming', () => {
    expect(parseEasRelationPropertyName('author_person_id')).toEqual({
      propertyName: 'authors',
      modelName: 'person',
      isList: false,
    })
    expect(parseEasRelationPropertyName('tag_tag_ids')?.isList).toBe(true)
  })

  it('related-seed property path should apply pickLatest before save', () => {
    // Mirrors getRelatedSeedsAndVersions: canonicalize then persist
    const rawRelated = [
      {
        id: 'old',
        refUID: 'relatedVersion1',
        schemaId: 'sTitle',
        timeCreated: 10,
      },
      {
        id: 'new',
        refUID: 'relatedVersion1',
        schemaId: 'sTitle',
        timeCreated: 30,
      },
      {
        id: 'body',
        refUID: 'relatedVersion1',
        schemaId: 'sBody',
        timeCreated: 20,
      },
    ]
    const canonical = pickLatestPropertyAttestationsByRefAndSchema(rawRelated)
    expect(canonical).toHaveLength(2)
    expect(canonical.find((a) => a.schemaId === 'sTitle')?.id).toBe('new')
  })
})
