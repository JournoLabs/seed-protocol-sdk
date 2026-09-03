import {
  getSeedsBySchemaName,
  EasClient,
  withExcludeRevokedFilter,
  GET_SEEDS,
} from '@seedprotocol/eas'
import { initializeQueryPlatform } from './bootstrap.js'
import { assembleSeeds } from './assembleSeeds.js'
import {
  buildAssembleOptionsKey,
  getQueryCacheManager,
} from './cache/index.js'
import type {
  AssembleOptions,
  AttestationLike,
  QueryBySchemaOptions,
  QueryBySchemaResult,
  SeedRecord,
} from './types.js'

function shouldUseCache(options?: AssembleOptions): boolean {
  if (options?.cache === false) return false
  return getQueryCacheManager().enabled
}

async function fetchAndAssemble(
  schemaName: string,
  limit: number,
  skip: number,
  options?: AssembleOptions,
): Promise<SeedRecord[]> {
  const seeds = (await getSeedsBySchemaName(
    schemaName,
    limit,
    skip,
  )) as AttestationLike[]
  return assembleSeeds(schemaName, seeds, options)
}

export async function queryBySchema(
  schemaName: string,
  options?: QueryBySchemaOptions,
): Promise<QueryBySchemaResult> {
  await initializeQueryPlatform()
  const limit = options?.limit ?? 100
  const skip = options?.skip ?? 0
  const optionsKey = buildAssembleOptionsKey(options)
  const useCache = shouldUseCache(options)
  const cache = getQueryCacheManager()

  // Collection cache only for skip=0 working set
  if (useCache && skip === 0) {
    return cache.withRefreshLock(schemaName, async () => {
      const cachedData = await cache.getCollection(schemaName)
      let items: SeedRecord[]
      let etag: string | undefined

      if (cachedData) {
        const pageItems = await fetchAndAssemble(
          schemaName,
          limit,
          0,
          options,
        )
        const newItems = cache.filterNewRecords(
          pageItems,
          cachedData.lastProcessedTimestamp,
        )

        if (newItems.length > 0) {
          items = cache
            .mergeRecords(cachedData.items, newItems)
            .slice(0, limit)
        } else {
          items = cachedData.items.slice(0, limit)
        }
      } else {
        items = await fetchAndAssemble(schemaName, limit, 0, options)
      }

      const stored = await cache.setCollection(schemaName, items)
      etag = stored?.etag
      await cache.writeThroughItems(items, optionsKey)

      return { items, limit, skip, etag }
    })
  }

  const items = await fetchAndAssemble(schemaName, limit, skip, options)
  if (useCache) {
    await cache.writeThroughItems(items, optionsKey)
  }
  return { items, limit, skip }
}

export async function getSeed(
  seedUid: string,
  options?: AssembleOptions,
): Promise<SeedRecord | null> {
  await initializeQueryPlatform()
  if (!seedUid || typeof seedUid !== 'string' || seedUid.trim() === '') {
    return null
  }

  const trimmed = seedUid.trim()
  const optionsKey = buildAssembleOptionsKey(options)
  const useCache = shouldUseCache(options)
  const cache = getQueryCacheManager()

  if (useCache) {
    const cached = await cache.getItem(trimmed, optionsKey)
    if (cached) {
      return cached.record
    }
  }

  const easClient = EasClient.getEasClient()
  const { itemSeeds } = await easClient.request(GET_SEEDS, {
    where: withExcludeRevokedFilter({
      id: { equals: trimmed },
    }),
    take: 1,
    skip: 0,
  })

  const seed = (itemSeeds ?? [])[0] as AttestationLike | undefined
  if (!seed) return null

  const schemaName = seed.schema?.schemaNames?.[0]?.name
  if (!schemaName) return null

  const records = await assembleSeeds(schemaName, [seed], options)
  const record = records[0] ?? null

  if (record && useCache) {
    await cache.setItem(record, optionsKey)
  }

  return record
}

/**
 * Query seeds of a schema created within a calendar month (local timezone bounds).
 * No collection cache this phase; may write-through to item cache.
 */
export async function queryBySchemaForMonth(
  schemaName: string,
  year: number,
  month: number,
  options?: AssembleOptions,
): Promise<SeedRecord[]> {
  await initializeQueryPlatform()
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59)
  const startTs = Math.floor(startDate.getTime() / 1000)
  const endTs = Math.floor(endDate.getTime() / 1000) + 1

  const where = withExcludeRevokedFilter({
    AND: [
      {
        schema: {
          is: {
            schemaNames: {
              some: {
                name: { equals: schemaName },
              },
            },
          },
        },
      },
      {
        timeCreated: { gte: startTs, lt: endTs },
      },
    ],
  })

  const easClient = EasClient.getEasClient()
  const { itemSeeds } = await easClient.request(GET_SEEDS, {
    where,
    take: 1000,
    skip: 0,
  })

  const seeds = (itemSeeds ?? []) as AttestationLike[]
  const items = await assembleSeeds(schemaName, seeds, options)

  if (shouldUseCache(options)) {
    const optionsKey = buildAssembleOptionsKey(options)
    await getQueryCacheManager().writeThroughItems(items, optionsKey)
  }

  return items
}
