import { initializeQueryPlatform } from './bootstrap.js'
import { assembleSeeds } from './assembleSeeds.js'
import { assembleSeedChangelog } from './assembleChangelog.js'
import {
  buildAssembleOptionsKey,
  getQueryCacheManager,
} from './cache/index.js'
import {
  normalizeSourceMode,
  resolveQuerySource,
  getRemoteQueryDataSource,
} from './source/index.js'
import type { QueryDataSource } from './source/types.js'
import type {
  AssembleOptions,
  GetSeedOptions,
  GetSeedResult,
  QueryBySchemaOptions,
  QueryBySchemaResult,
  SeedRecord,
} from './types.js'

function shouldUseCache(
  options: AssembleOptions | undefined,
  allowCache: boolean,
): boolean {
  if (!allowCache) return false
  if (options?.cache === false) return false
  return getQueryCacheManager().enabled
}

function wantsChangelog(include: GetSeedOptions['include']): boolean {
  return include === 'data+changelog' || include === 'changelog'
}

function wantsData(include: GetSeedOptions['include']): boolean {
  return include !== 'changelog'
}

async function fetchAndAssemble(
  schemaName: string,
  limit: number,
  skip: number,
  options: AssembleOptions | undefined,
  dataSource: QueryDataSource,
): Promise<SeedRecord[]> {
  const seeds = await dataSource.listSeedsBySchemaName(schemaName, {
    limit,
    skip,
  })
  return assembleSeeds(schemaName, seeds, options, dataSource)
}

/**
 * For `source: 'auto'`: try local first; if empty/miss, fall back to remote.
 */
async function withAutoFallbackForCollection(
  mode: ReturnType<typeof normalizeSourceMode>,
  dataSource: QueryDataSource,
  run: (ds: QueryDataSource) => Promise<SeedRecord[]>,
): Promise<{ items: SeedRecord[]; dataSource: QueryDataSource; useQueryCache: boolean }> {
  const items = await run(dataSource)
  if (mode !== 'auto' || dataSource.kind !== 'local') {
    return {
      items,
      dataSource,
      useQueryCache: dataSource.kind === 'remote',
    }
  }
  if (items.length > 0) {
    return { items, dataSource, useQueryCache: false }
  }
  const remote = getRemoteQueryDataSource()
  const remoteItems = await run(remote)
  return { items: remoteItems, dataSource: remote, useQueryCache: true }
}

export async function queryBySchema(
  schemaName: string,
  options?: QueryBySchemaOptions,
): Promise<QueryBySchemaResult> {
  await initializeQueryPlatform()
  const limit = options?.limit ?? 100
  const skip = options?.skip ?? 0
  const mode = normalizeSourceMode(options?.source)
  const resolved = resolveQuerySource(mode)
  const optionsKey = buildAssembleOptionsKey(options)

  const runAssemble = (ds: QueryDataSource) =>
    fetchAndAssemble(schemaName, limit, skip, options, ds)

  // Collection cache only for remote + skip=0 working set
  if (
    shouldUseCache(options, resolved.useQueryCache) &&
    skip === 0 &&
    resolved.dataSource.kind === 'remote'
  ) {
    const cache = getQueryCacheManager()
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
          resolved.dataSource,
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
        items = await fetchAndAssemble(
          schemaName,
          limit,
          0,
          options,
          resolved.dataSource,
        )
      }

      const stored = await cache.setCollection(schemaName, items)
      etag = stored?.etag
      await cache.writeThroughItems(items, optionsKey)

      return { items, limit, skip, etag }
    })
  }

  const {
    items,
    dataSource: used,
    useQueryCache,
  } = await withAutoFallbackForCollection(mode, resolved.dataSource, (ds) =>
    runAssemble(ds),
  )

  if (shouldUseCache(options, useQueryCache) && used.kind === 'remote') {
    await getQueryCacheManager().writeThroughItems(items, optionsKey)
  }
  return { items, limit, skip }
}

export async function getSeed(
  seedUid: string,
  options?: GetSeedOptions,
): Promise<GetSeedResult | null> {
  await initializeQueryPlatform()
  if (!seedUid || typeof seedUid !== 'string' || seedUid.trim() === '') {
    return null
  }

  const trimmed = seedUid.trim()
  const include = options?.include ?? 'data'
  const mode = normalizeSourceMode(options?.source)
  const resolved = resolveQuerySource(mode)
  const optionsKey = buildAssembleOptionsKey(options)

  let dataSource = resolved.dataSource
  let allowCache = resolved.useQueryCache

  if (shouldUseCache(options, allowCache) && dataSource.kind === 'remote') {
    const cached = await getQueryCacheManager().getItem(trimmed, optionsKey)
    if (cached) {
      return cached.record
    }
  }

  let seed = await dataSource.getSeedByUid(trimmed)

  // auto: local miss → remote
  if (!seed && mode === 'auto' && dataSource.kind === 'local') {
    dataSource = getRemoteQueryDataSource()
    allowCache = true
    seed = await dataSource.getSeedByUid(trimmed)
    if (shouldUseCache(options, allowCache)) {
      const cached = await getQueryCacheManager().getItem(trimmed, optionsKey)
      if (cached) {
        return cached.record
      }
    }
  }

  if (!seed) return null

  const schemaName = seed.schema?.schemaNames?.[0]?.name
  if (!schemaName) return null

  let result: GetSeedResult | null = null

  if (!wantsChangelog(include)) {
    const records = await assembleSeeds(schemaName, [seed], options, dataSource)
    result = records[0] ?? null
  } else {
    const { latestVersionUid, changelog } = await assembleSeedChangelog(
      trimmed,
      options,
      dataSource,
    )

    if (wantsData(include)) {
      const records = await assembleSeeds(
        schemaName,
        [seed],
        options,
        dataSource,
      )
      const record = records[0]
      if (!record) {
        result = null
      } else {
        result = { ...record, changelog }
      }
    } else {
      result = {
        seedUid: trimmed,
        schemaName,
        attester: seed.attester,
        timeCreated: seed.timeCreated,
        versionUid: latestVersionUid,
        data: {},
        changelog,
      }
    }
  }

  if (
    result &&
    shouldUseCache(options, allowCache) &&
    dataSource.kind === 'remote'
  ) {
    await getQueryCacheManager().setItem(result, optionsKey)
  }

  return result
}

/**
 * Query seeds of a schema created within a calendar month (local timezone bounds).
 * No collection cache; may write-through to item cache when remote.
 */
export async function queryBySchemaForMonth(
  schemaName: string,
  year: number,
  month: number,
  options?: AssembleOptions,
): Promise<SeedRecord[]> {
  await initializeQueryPlatform()
  const mode = normalizeSourceMode(options?.source)
  const resolved = resolveQuerySource(mode)

  const run = async (ds: QueryDataSource) => {
    const seeds = await ds.listSeedsBySchemaNameForMonth(
      schemaName,
      year,
      month,
    )
    return assembleSeeds(schemaName, seeds, options, ds)
  }

  const { items, dataSource: used, useQueryCache } =
    await withAutoFallbackForCollection(mode, resolved.dataSource, run)

  if (shouldUseCache(options, useQueryCache) && used.kind === 'remote') {
    const optionsKey = buildAssembleOptionsKey(options)
    await getQueryCacheManager().writeThroughItems(items, optionsKey)
  }

  return items
}
