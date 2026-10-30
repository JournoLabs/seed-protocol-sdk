import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { assembleSeeds } from '../src/assembleSeeds'
import { buildAssembleOptionsKey } from '../src/cache/index'
import { decodePropertyAttestation } from '../src/changelog'
import { setQueryModels, type QueryModels } from '../src/queryModels'
import type { QueryDataSource } from '../src/source/types'
import type { AttestationLike } from '../src/types'

const POST = '0x' + 'a'.repeat(64)
const POST_V = '0x' + 'b'.repeat(64)
const PERSON = '0x' + 'c'.repeat(64)
const CLIP = '0x' + 'd'.repeat(64)

const prop = (id: string, name: string, value: unknown, type: string): AttestationLike => ({
  id,
  refUID: POST_V,
  schemaId: `0xschema-${name}`,
  timeCreated: 20,
  decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
})

const coAuthors = prop('0xp1', 'co_author_identity_ids', [PERSON], 'bytes32[]')
const featured = prop('0xp2', 'featured_portfolio_clip_ids', [CLIP], 'bytes32[]')
const tags = prop('0xp3', 'tag_identity_ids', [PERSON], 'bytes32[]')

const source: QueryDataSource = {
  kind: 'local',
  getSeedByUid: async () => null,
  listSeedsBySchemaName: async () => [],
  listSeedsBySchemaNameForMonth: async () => [],
  getVersionsForSeed: async () => [],
  getVersionsForSeeds: async (uids) =>
    uids.includes(POST) ? [{ id: POST_V, refUID: POST, schemaId: '0xv', timeCreated: 11, decodedDataJson: '' }] : [],
  getPropertiesForVersionUids: async (uids) => (uids.includes(POST_V) ? [coAuthors, featured, tags] : []),
  getSeedsByUids: async () => [],
}

const postSeed: AttestationLike = {
  id: POST,
  refUID: '0x0',
  schemaId: '0xseed',
  timeCreated: 10,
  decodedDataJson: '',
  schema: { schemaNames: [{ name: 'blog_post' }] },
}

// As a schema file has them: `ref`, and the older `items.model`
const models: QueryModels = {
  BlogPost: {
    properties: {
      title: { type: 'Text' },
      coAuthors: { type: 'List', refValueType: 'Relation', ref: 'Identity' },
      featured: { type: 'List', items: { model: 'PortfolioClip' } },
    },
  },
}

const assemble = async (relations: 'expand' | 'uids') =>
  (await assembleSeeds('blog_post', [postSeed], { relations, hydrateStorage: false }, source))[0]!.data

afterEach(() => setQueryModels(null))

describe('List relation keys from the schema models', () => {
  it.each(['expand', 'uids'] as const)("'%s' returns each list under its schema key", async (relations) => {
    setQueryModels(models)
    const data = await assemble(relations)
    expect(data).toMatchObject({ co_authors: [PERSON], coAuthors: [PERSON], featured: [CLIP] })
    for (const parsed of ['cos', 'featureds', 'co_author_identity_ids', 'featured_portfolio_clip_ids']) {
      expect(data).not.toHaveProperty(parsed)
    }
    // A list the models don't name keeps the parse
    expect(data.tags).toEqual([PERSON])
  })

  it('reads models and properties written as arrays', async () => {
    const asArrays: QueryModels = Object.entries(models as Record<string, { properties: object }>).map(([name, model]) => ({
      name,
      properties: Object.entries(model.properties).map(([propertyName, property]) => ({ name: propertyName, ...property })),
    }))
    setQueryModels(asArrays)
    const key = buildAssembleOptionsKey({ relations: 'uids' })
    expect(await assemble('uids')).toMatchObject({ coAuthors: [PERSON], featured: [CLIP] })
    setQueryModels(models)
    expect(buildAssembleOptionsKey({ relations: 'uids' })).toBe(key)
  })

  it('without models, keeps the first word, plural', async () => {
    expect(await assemble('uids')).toMatchObject({ cos: [PERSON], featureds: [CLIP] })
  })

  it('names lists the same way in changelog entries', () => {
    setQueryModels(models)
    expect(decodePropertyAttestation(coAuthors, 'blog_post')).toMatchObject({
      propertyName: 'co_authors',
      camelName: 'coAuthors',
    })
    // With no model, a key every model agrees on
    expect(decodePropertyAttestation(featured)).toMatchObject({ propertyName: 'featured' })
  })

  it('puts the models in the cache key, and drops them when cleared', () => {
    const plain = buildAssembleOptionsKey({ relations: 'uids' })
    setQueryModels(models)
    const withModels = buildAssembleOptionsKey({ relations: 'uids' })
    expect(withModels).toMatch(/^e7-h1-m[0-9a-f]{8}$/)
    setQueryModels({ BlogPost: { properties: { coAuthors: { type: 'List', ref: 'Person' } } } })
    expect(buildAssembleOptionsKey({ relations: 'uids' })).not.toBe(withModels)
    setQueryModels(null)
    expect(buildAssembleOptionsKey({ relations: 'uids' })).toBe(plain)
  })
})
