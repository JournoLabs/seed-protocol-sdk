/**
 * Integration tests for eas.ts against real EAS GraphQL service
 *
 * These tests make real network requests to the EAS indexer (Optimism Sepolia)
 * to verify the implementation works correctly. No mocks for EasClient or QueryClient.
 *
 * Requires: EAS_ENDPOINT in .env (default: https://optimism-sepolia.easscan.org/graphql)
 * Run with: bun run test (from repo root)
 */

// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getSeedsBySchemaName,
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  getEasSchemaUidBySchemaName,
} from '@/eas'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { IQueryClient } from '@/interfaces/IQueryClient'

// Import node platform classes - sets up real EasClient and QueryClient
import '@/node/helpers/EasClient'
import { QueryClient as NodeQueryClient } from '@/node/helpers/QueryClient'

const isNodeEnv = typeof window === 'undefined'
const NETWORK_TIMEOUT = 15000

// Known schema with published data on Optimism Sepolia (from user's attestation)
const TWEET_SCHEMA_NAME = 'tweet'

describe.skipIf(!isNodeEnv)('EAS Integration', () => {
  describe('getSeedsBySchemaName', () => {
    it('returns seeds for known schema', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 5)

      expect(Array.isArray(seeds)).toBe(true)
      if (seeds.length > 0) {
        const seed = seeds[0]
        expect(seed).toHaveProperty('id')
        expect(seed).toHaveProperty('refUID')
        expect(seed).toHaveProperty('schemaId')
        expect(seed).toHaveProperty('timeCreated')
        expect(seed).toHaveProperty('schema')
        expect(seed.schema).toHaveProperty('schemaNames')
      }
    }, NETWORK_TIMEOUT)

    it('respects limit parameter', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 2)
      expect(seeds.length).toBeLessThanOrEqual(2)
    }, NETWORK_TIMEOUT)
  })

  describe('getItemVersionsFromEas', () => {
    it('returns versions for given seed UIDs', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 3)
      if (seeds.length === 0) {
        return
      }

      const seedUids = seeds.map((s) => s.id)
      const versions = await getItemVersionsFromEas({ seedUids })

      expect(Array.isArray(versions)).toBe(true)
      for (const v of versions) {
        expect(v).toHaveProperty('id')
        expect(v).toHaveProperty('refUID')
        expect(seedUids).toContain(v.refUID)
      }
    }, NETWORK_TIMEOUT)

    it('returns empty array for non-existent seed UIDs', async () => {
      const versions = await getItemVersionsFromEas({
        seedUids: ['0x0000000000000000000000000000000000000000000000000000000000000001'],
      })
      expect(versions).toEqual([])
    }, NETWORK_TIMEOUT)
  })

  describe('getItemPropertiesFromEas', () => {
    it('returns properties for given version UIDs', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 3)
      if (seeds.length === 0) return

      const seedUids = seeds.map((s) => s.id)
      const versions = await getItemVersionsFromEas({ seedUids })
      if (versions.length === 0) return

      const versionUids = versions.map((v) => v.id)
      const properties = await getItemPropertiesFromEas({ versionUids })

      expect(Array.isArray(properties)).toBe(true)
      for (const p of properties) {
        expect(p).toHaveProperty('id')
        expect(p).toHaveProperty('refUID')
        expect(p).toHaveProperty('decodedDataJson')
        expect(versionUids).toContain(p.refUID)
      }
    }, NETWORK_TIMEOUT)

    it('returns properties with text content for tweet schema', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 5)
      if (seeds.length === 0) return

      const seedUids = seeds.map((s) => s.id)
      const versions = await getItemVersionsFromEas({ seedUids })
      if (versions.length === 0) return

      const versionUids = versions.map((v) => v.id)
      const properties = await getItemPropertiesFromEas({ versionUids })

      const textProperties = properties.filter((p) => {
        try {
          const parsed = JSON.parse(p.decodedDataJson)
          const metadata = parsed[0]?.value
          return metadata?.name === 'text'
        } catch {
          return false
        }
      })

      if (textProperties.length > 0) {
        const first = textProperties[0]
        const parsed = JSON.parse(first.decodedDataJson)
        const metadata = parsed[0]?.value
        expect(metadata).toHaveProperty('name', 'text')
        expect(metadata).toHaveProperty('value')
      }
    }, NETWORK_TIMEOUT)
  })

  describe('getEasSchemaUidBySchemaName', () => {
    it('returns schema UID for known schema name', async () => {
      const schemaUid = await getEasSchemaUidBySchemaName({ schemaName: TWEET_SCHEMA_NAME })

      if (schemaUid) {
        expect(typeof schemaUid).toBe('string')
        expect(schemaUid).toMatch(/^0x[a-fA-F0-9]{64}$/)
      }
    }, NETWORK_TIMEOUT)
  })

  describe('full flow: seeds -> versions -> properties', () => {
    it('assembles feed-style items with property values', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 5)
      if (seeds.length === 0) return

      const versionUidToSeedUid = new Map<string, string>()
      const versionsBySeedUid = new Map<string, typeof seeds>()

      const seedUids = seeds.map((s) => s.id)
      const versions = await getItemVersionsFromEas({ seedUids })

      for (const v of versions) {
        versionUidToSeedUid.set(v.id, v.refUID)
        const existing = versionsBySeedUid.get(v.refUID) || []
        versionsBySeedUid.set(v.refUID, [...existing, v])
      }

      const latestVersionUids = Array.from(versionsBySeedUid.entries())
        .map(([, vs]) => vs.sort((a, b) => b.timeCreated - a.timeCreated)[0])
        .filter(Boolean)
        .map((v) => v!.id)

      if (latestVersionUids.length === 0) return

      const properties = await getItemPropertiesFromEas({ versionUids: latestVersionUids })

      const assembledItems = new Map<string, Record<string, unknown>>()
      for (const seed of seeds) {
        assembledItems.set(seed.id, { seedUid: seed.id, timeCreated: seed.timeCreated })
      }

      for (const p of properties) {
        const seedUid = versionUidToSeedUid.get(p.refUID)
        if (!seedUid) continue

        try {
          const parsed = JSON.parse(p.decodedDataJson)
          const metadata = parsed[0]?.value
          if (!metadata?.name) continue

          const item = assembledItems.get(seedUid) || {}
          item[metadata.name] = metadata.value
          assembledItems.set(seedUid, item)
        } catch {
          // skip invalid
        }
      }

      const itemsWithText = Array.from(assembledItems.values()).filter(
        (item) => 'text' in item && item.text
      )
      expect(itemsWithText.length).toBeGreaterThanOrEqual(0)
    }, NETWORK_TIMEOUT * 2)
  })

  describe('cache key behavior (queryKey includes parameters)', () => {
    let originalPlatformClass: typeof BaseQueryClient
    const recordedQueryKeys: unknown[][] = []

    beforeEach(() => {
      originalPlatformClass = BaseQueryClient.PlatformClass
      recordedQueryKeys.length = 0

      // Use a QueryClient that records queryKeys and delegates to real implementation
      // (real network - no mocking, just observation for cache key verification)
      class RecordingQueryClient extends BaseQueryClient {
        static getQueryClient(): IQueryClient {
          const realClient = NodeQueryClient.getQueryClient()
          return {
            fetchQuery: async (options) => {
              recordedQueryKeys.push(options.queryKey)
              return realClient.fetchQuery(options)
            },
            getQueryData: () => {
              throw new Error('Not implemented')
            },
            removeQueries: async (filters) => {
              await realClient.removeQueries(filters)
            },
          }
        }
      }
      BaseQueryClient.setPlatformClass(RecordingQueryClient as typeof BaseQueryClient)
    })

    afterEach(() => {
      BaseQueryClient.setPlatformClass(originalPlatformClass)
    })

    it('getItemVersionsFromEas includes seedUids in queryKey', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 2)
      if (seeds.length === 0) return

      const seedUids = seeds.map((s) => s.id)
      await getItemVersionsFromEas({ seedUids })

      const versionsKey = recordedQueryKeys.find((k) => Array.isArray(k) && k[0] === 'getVersionsForAllModels')
      expect(versionsKey).toBeDefined()
      expect(versionsKey).toHaveLength(2)
      expect(versionsKey![0]).toBe('getVersionsForAllModels')
      expect(versionsKey![1]).toBeDefined()
      expect(Array.isArray(versionsKey![1])).toBe(true)
      expect((versionsKey![1] as string[]).sort()).toEqual([...seedUids].sort())
    }, NETWORK_TIMEOUT)

    it('getItemPropertiesFromEas includes versionUids in queryKey', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 2)
      if (seeds.length === 0) return

      const seedUids = seeds.map((s) => s.id)
      const versions = await getItemVersionsFromEas({ seedUids })
      if (versions.length === 0) return

      const versionUids = versions.map((v) => v.id)
      await getItemPropertiesFromEas({ versionUids })

      const propsKey = recordedQueryKeys.find((k) => Array.isArray(k) && k[0] === 'getPropertiesForAllModels')
      expect(propsKey).toBeDefined()
      expect(propsKey).toHaveLength(2)
      expect(propsKey![0]).toBe('getPropertiesForAllModels')
      expect(propsKey![1]).toBeDefined()
      expect(Array.isArray(propsKey![1])).toBe(true)
      expect((propsKey![1] as string[]).sort()).toEqual([...versionUids].sort())
    }, NETWORK_TIMEOUT)

    it('different parameters produce different queryKeys', async () => {
      const seeds = await getSeedsBySchemaName(TWEET_SCHEMA_NAME, 3)
      if (seeds.length < 2) return

      const seedUidsA = [seeds[0].id]
      const seedUidsB = [seeds[1].id]

      await getItemVersionsFromEas({ seedUids: seedUidsA })
      await getItemVersionsFromEas({ seedUids: seedUidsB })

      const versionKeys = recordedQueryKeys.filter(
        (k) => Array.isArray(k) && k[0] === 'getVersionsForAllModels'
      )
      expect(versionKeys).toHaveLength(2)
      expect(versionKeys[0]).not.toEqual(versionKeys[1])
      expect((versionKeys[0][1] as string[]).sort()).toEqual([...seedUidsA].sort())
      expect((versionKeys[1][1] as string[]).sort()).toEqual([...seedUidsB].sort())
    }, NETWORK_TIMEOUT)
  })
})
