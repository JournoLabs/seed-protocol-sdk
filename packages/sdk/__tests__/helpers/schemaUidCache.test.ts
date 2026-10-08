import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BaseEasClient,
  BaseQueryClient,
  SCHEMA_LOOKUP_MISS_TTL_MS,
  getEasSchemaUidForExactDefinition,
  getEasSchemaUidForSchemaDefinition,
  resetSchemaUidCaches,
  setSchemaUidForModel,
  setSchemaUidForSchemaDefinition,
} from '@seedprotocol/eas'
import { NodeQueryClient } from '@seedprotocol/eas/node'
import { BaseDb } from '@/db/Db/BaseDb'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'

const UID_A = '0x' + 'a'.repeat(64)
const UID_B = '0x' + 'b'.repeat(64)

/** Stub EAS indexer: answers every schema query with `schemas`, counting requests. */
let schemas: Array<{ id: string }> = []
let failNext = false
const request = vi.fn(async () => {
  if (failNext) {
    failNext = false
    throw new Error('indexer unavailable')
  }
  return { schemas }
})

beforeEach(() => {
  resetSchemaUidCaches()
  schemas = []
  failNext = false
  request.mockClear()
  BaseQueryClient.configure(new NodeQueryClient())
  BaseEasClient.configure({ getEasClient: () => ({ request }) as never })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getEasSchemaUidForExactDefinition', () => {
  it('caches a found UID', async () => {
    schemas = [{ id: UID_A }]
    expect(await getEasSchemaUidForExactDefinition('string title')).toBe(UID_A)
    expect(await getEasSchemaUidForExactDefinition('string title')).toBe(UID_A)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('caches a miss per definition', async () => {
    expect(await getEasSchemaUidForExactDefinition('string title')).toBeUndefined()
    expect(await getEasSchemaUidForExactDefinition('string title')).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)

    await getEasSchemaUidForExactDefinition('string body')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('looks up again once the schema is registered in this client', async () => {
    expect(await getEasSchemaUidForExactDefinition('string title')).toBeUndefined()

    // e.g. publish's ensureEasSchemasForItem after registering it on-chain
    setSchemaUidForSchemaDefinition({ text: 'string title', schemaUid: UID_A })
    schemas = [{ id: UID_A }]

    expect(await getEasSchemaUidForExactDefinition('string title')).toBe(UID_A)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('looks up again after the miss TTL (schema registered by another client)', async () => {
    vi.useFakeTimers({ now: 0 })
    await getEasSchemaUidForExactDefinition('string title')
    schemas = [{ id: UID_A }]

    vi.setSystemTime(SCHEMA_LOOKUP_MISS_TTL_MS - 1)
    expect(await getEasSchemaUidForExactDefinition('string title')).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)

    vi.setSystemTime(SCHEMA_LOOKUP_MISS_TTL_MS)
    expect(await getEasSchemaUidForExactDefinition('string title')).toBe(UID_A)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed request', async () => {
    failNext = true
    await expect(getEasSchemaUidForExactDefinition('string title')).rejects.toThrow('indexer unavailable')

    schemas = [{ id: UID_A }]
    expect(await getEasSchemaUidForExactDefinition('string title')).toBe(UID_A)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('shares one request between concurrent lookups', async () => {
    const results = await Promise.all([
      getEasSchemaUidForExactDefinition('string title'),
      getEasSchemaUidForExactDefinition('string title'),
    ])
    expect(results).toEqual([undefined, undefined])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not cache a miss that was in flight when a schema got registered', async () => {
    const lookup = getEasSchemaUidForExactDefinition('string title')
    setSchemaUidForSchemaDefinition({ text: 'string title', schemaUid: UID_A })
    expect(await lookup).toBeUndefined()

    schemas = [{ id: UID_A }]
    expect(await getEasSchemaUidForExactDefinition('string title')).toBe(UID_A)
    expect(request).toHaveBeenCalledTimes(2)
  })
})

describe('getEasSchemaUidForSchemaDefinition', () => {
  it('caches misses and forgets them when a schema is registered', async () => {
    expect(await getEasSchemaUidForSchemaDefinition({ schemaText: 'title' })).toBeUndefined()
    expect(await getEasSchemaUidForSchemaDefinition({ schemaText: 'title' })).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)

    setSchemaUidForSchemaDefinition({ text: 'string title', schemaUid: UID_A })
    schemas = [{ id: UID_A }]
    expect(await getEasSchemaUidForSchemaDefinition({ schemaText: 'title' })).toBe(UID_A)
    expect(await getEasSchemaUidForSchemaDefinition({ schemaText: 'title' })).toBe(UID_A)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('returns undefined without caching when the request fails', async () => {
    failNext = true
    expect(await getEasSchemaUidForSchemaDefinition({ schemaText: 'title' })).toBeUndefined()
    schemas = [{ id: UID_A }]
    expect(await getEasSchemaUidForSchemaDefinition({ schemaText: 'title' })).toBe(UID_A)
  })
})

describe('getEasSchemaUidForModel', () => {
  beforeEach(() => {
    // No local DB: only the EAS lookup can find a UID.
    vi.spyOn(BaseDb, 'getAppDb').mockReturnValue(undefined as never)
  })

  it('caches a miss and forgets it when a model schema is registered', async () => {
    expect(await getEasSchemaUidForModel('Article')).toBeUndefined()
    expect(await getEasSchemaUidForModel('Article')).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)

    // Registering another model's schema clears cached misses; Article is then found on EAS.
    setSchemaUidForModel({ modelName: 'Post', schemaUid: UID_B })
    schemas = [{ id: UID_A }]
    expect(await getEasSchemaUidForModel('Article')).toBe(UID_A)
    expect(await getEasSchemaUidForModel('Article')).toBe(UID_A)
    expect(request).toHaveBeenCalledTimes(2)
  })
})
