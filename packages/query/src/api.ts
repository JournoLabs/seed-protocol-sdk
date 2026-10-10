import { initializeQueryPlatform } from './bootstrap.js'
import {
  assembleSeedsWithDependencies,
  type SeedDependencies,
} from './assembleSeeds.js'
import { assembleSeedChangelog } from './assembleChangelog.js'
import {
  buildAssembleOptionsKey,
  getQueryCacheManager,
} from './cache/index.js'
import {
  checkedAtFor,
  checkWindowAged,
  findChangedSeeds,
  nowSeconds,
} from './cache/changes.js'
import type { CachedRecordMeta } from './cache/types.js'
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

const NO_DEPENDENCIES: SeedDependencies = { refUIDs: [], ids: [] }

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

type Assembled = {
  records: SeedRecord[]
  dependencies: Map<string, SeedDependencies>
}

async function fetchAndAssemble(
  schemaName: string,
  limit: number,
  skip: number,
  options: AssembleOptions | undefined,
  dataSource: QueryDataSource,
): Promise<Assembled> {
  const seeds = await dataSource.listSeedsBySchemaName(schemaName, {
    limit,
    skip,
  })
  return assembleSeedsWithDependencies(schemaName, seeds, options, dataSource)
}

/**
 * For `source: 'auto'`: try local first; if empty/miss, fall back to remote.
 */
async function withAutoFallbackForCollection(
  mode: ReturnType<typeof normalizeSourceMode>,
  dataSource: QueryDataSource,
  run: (ds: QueryDataSource) => Promise<Assembled>,
): Promise<{ assembled: Assembled; dataSource: QueryDataSource; useQueryCache: boolean }> {
  const assembled = await run(dataSource)
  if (mode !== 'auto' || dataSource.kind !== 'local') {
    return {
      assembled,
      dataSource,
      useQueryCache: dataSource.kind === 'remote',
    }
  }
  if (assembled.records.length > 0) {
    return { assembled, dataSource, useQueryCache: false }
  }
  const remote = getRemoteQueryDataSource()
  return { assembled: await run(remote), dataSource: remote, useQueryCache: true }
}

/** Item-cache write-through for records assembled by a read that started at `startedAt`. */
async function writeThroughAssembled(
  assembled: Assembled,
  optionsKey: string,
  startedAt: number,
  seenChangeKeys: string[] = [],
): Promise<void> {
  await getQueryCacheManager().writeThroughItems(
    assembled.records.map((record) => ({
      record,
      optionsKey,
      dependencies: assembled.dependencies.get(record.seedUid) ?? NO_DEPENDENCIES,
      checkedAt: checkedAtFor(startedAt),
      seenChangeKeys,
      lastUpdated: startedAt,
    })),
  )
}

/**
 * The schema's first `limit` seeds, newest first, from the collection cache where they haven't
 * changed. The seed list itself is always fetched (it's cheap, and shows new and revoked seeds);
 * cached seeds are checked for changes in one request (see findChangedSeeds), and only new or
 * changed seeds are assembled. The TTL counts from the last full assembly.
 */
async function refreshCollection(
  schemaName: string,
  limit: number,
  options: QueryBySchemaOptions | undefined,
  optionsKey: string,
  dataSource: QueryDataSource,
): Promise<QueryBySchemaResult> {
  const cache = getQueryCacheManager()
  const startedAt = nowSeconds()
  const cached = await cache.getCollection(schemaName, optionsKey)
  const listed = await dataSource.listSeedsBySchemaName(schemaName, { limit, skip: 0 })

  const cachedBySeedUid = new Map(cached?.items.map((item) => [item.seedUid, item]) ?? [])
  let changed = new Set<string>()
  let seenChangeKeys: string[] = []
  if (cached) {
    const toCheck = new Map<string, SeedDependencies>()
    for (const seed of listed) {
      const meta = cached.meta[seed.id]
      if (cachedBySeedUid.has(seed.id)) toCheck.set(seed.id, meta?.dependencies ?? NO_DEPENDENCIES)
    }
    const found = await findChangedSeeds(dataSource, toCheck, cached)
    if (found) {
      changed = found.changed
      seenChangeKeys = found.seenChangeKeys
    } else {
      changed = new Set(toCheck.keys())
    }
  }

  const toAssemble = listed.filter((seed) => !cachedBySeedUid.has(seed.id) || changed.has(seed.id))
  const fresh =
    toAssemble.length > 0
      ? await assembleSeedsWithDependencies(schemaName, toAssemble, options, dataSource)
      : { records: [], dependencies: new Map<string, SeedDependencies>() } satisfies Assembled
  const freshBySeedUid = new Map(fresh.records.map((record) => [record.seedUid, record]))

  // In list order. A changed seed that no longer assembles (every version revoked) drops out,
  // as do cached seeds no longer listed (revoked, or pushed past `limit`).
  const items: SeedRecord[] = []
  const meta: Record<string, CachedRecordMeta> = {}
  for (const seed of listed) {
    const record = freshBySeedUid.get(seed.id)
    if (record) {
      items.push(record)
      meta[seed.id] = {
        dependencies: fresh.dependencies.get(seed.id) ?? NO_DEPENDENCIES,
        builtAt: startedAt,
      }
    } else if (cached && !changed.has(seed.id) && cachedBySeedUid.has(seed.id)) {
      items.push(cachedBySeedUid.get(seed.id)!)
      meta[seed.id] = cached.meta[seed.id] ?? { dependencies: NO_DEPENDENCIES, builtAt: startedAt }
    }
  }

  const unchanged =
    !!cached &&
    fresh.records.length === 0 &&
    items.length === cached.items.length &&
    items.every((item, i) => item === cached.items[i])
  if (cached && unchanged && !checkWindowAged(cached, startedAt)) {
    return { items, limit, skip: 0, etag: cached.etag }
  }
  if (cached) cache.recordRefresh()

  const stored = await cache.setCollection(schemaName, optionsKey, {
    items,
    meta,
    checkedAt: checkedAtFor(startedAt),
    seenChangeKeys,
    lastUpdated: cached?.lastUpdated ?? startedAt,
  })
  await writeThroughAssembled(fresh, optionsKey, startedAt, seenChangeKeys)
  return { items, limit, skip: 0, etag: stored?.etag }
}

/** Hex digits a uid prefix needs, so a stray short value can't list most of a schema. */
const MIN_UID_PREFIX_HEX_DIGITS = 4

/**
 * `0x` + lowercase hex for a seed UID prefix given with or without `0x`, in any case (EAS indexes
 * UIDs lowercase and matches prefixes case-sensitively). Null when it isn't 4–64 hex digits.
 */
export function normalizeUidPrefix(prefix: string): string | null {
  const hex = prefix.trim().toLowerCase().replace(/^0x/, '')
  if (hex.length < MIN_UID_PREFIX_HEX_DIGITS || hex.length > 64) return null
  if (!/^[0-9a-f]+$/.test(hex)) return null
  return `0x${hex}`
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

  let uidPrefix: string | null = null
  if (options?.uidPrefix !== undefined) {
    uidPrefix = normalizeUidPrefix(options.uidPrefix)
    if (!uidPrefix) return { items: [], limit, skip }
  }

  const runAssemble = async (ds: QueryDataSource): Promise<Assembled> => {
    if (!uidPrefix) return fetchAndAssemble(schemaName, limit, skip, options, ds)
    const seeds = await ds.listSeedsByUidPrefix(schemaName, uidPrefix, { limit, skip })
    return assembleSeedsWithDependencies(schemaName, seeds, options, ds)
  }

  // Collection cache only for remote + skip=0 working set (a uid-prefix match isn't one)
  if (
    !uidPrefix &&
    shouldUseCache(options, resolved.useQueryCache) &&
    skip === 0 &&
    resolved.dataSource.kind === 'remote'
  ) {
    const lockKey = `${schemaName}\n${optionsKey}\n${limit}`
    return getQueryCacheManager().withRefreshLock(lockKey, () =>
      refreshCollection(schemaName, limit, options, optionsKey, resolved.dataSource),
    )
  }

  const startedAt = nowSeconds()
  const {
    assembled,
    dataSource: used,
    useQueryCache,
  } = await withAutoFallbackForCollection(mode, resolved.dataSource, (ds) =>
    runAssemble(ds),
  )

  if (shouldUseCache(options, useQueryCache) && used.kind === 'remote') {
    await writeThroughAssembled(assembled, optionsKey, startedAt)
  }
  return { items: assembled.records, limit, skip }
}

/**
 * The cached item for a seed if nothing it depends on changed since it was last checked (see
 * findChangedSeeds); otherwise drops it and returns null so the caller assembles it again.
 */
async function getUnchangedCachedItem(
  seedUid: string,
  optionsKey: string,
  dataSource: QueryDataSource,
): Promise<GetSeedResult | null> {
  const cache = getQueryCacheManager()
  const cached = await cache.getItem(seedUid, optionsKey)
  if (!cached) return null

  const startedAt = nowSeconds()
  const found = await findChangedSeeds(
    dataSource,
    new Map([[seedUid, cached.dependencies]]),
    cached,
  )
  if (!found || found.changed.has(seedUid)) {
    await cache.clearItem(seedUid, optionsKey)
    return null
  }
  if (checkWindowAged(cached, startedAt)) {
    await cache.setItem({
      ...cached,
      checkedAt: checkedAtFor(startedAt),
      seenChangeKeys: found.seenChangeKeys,
    })
  }
  return cached.record
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
    const cached = await getUnchangedCachedItem(trimmed, optionsKey, dataSource)
    if (cached) return cached
  }

  // The seed's versions only need its UID, so they are fetched alongside the seed (assembly
  // would otherwise ask for them after it).
  const fetchSeedAndVersions = (ds: QueryDataSource) =>
    Promise.all([
      ds.getSeedByUid(trimmed),
      ds.getVersionsForSeeds([trimmed], { includeRevoked: true }),
    ])

  const startedAt = nowSeconds()
  let [seed, versions] = await fetchSeedAndVersions(dataSource)

  // auto: local miss → remote
  if (!seed && mode === 'auto' && dataSource.kind === 'local') {
    dataSource = getRemoteQueryDataSource()
    allowCache = true
    if (shouldUseCache(options, allowCache)) {
      const cached = await getUnchangedCachedItem(trimmed, optionsKey, dataSource)
      if (cached) return cached
    }
    ;[seed, versions] = await fetchSeedAndVersions(dataSource)
  }

  if (!seed) return null

  const schemaName = seed.schema?.schemaNames?.[0]?.name
  if (!schemaName) return null

  let result: GetSeedResult | null = null
  let dependencies: SeedDependencies = { refUIDs: [trimmed], ids: [trimmed] }

  const assembleData = async (): Promise<SeedRecord | null> => {
    const assembled = await assembleSeedsWithDependencies(schemaName, [seed], options, dataSource, {
      versions,
    })
    const record = assembled.records[0]
    if (record) dependencies = assembled.dependencies.get(record.seedUid) ?? dependencies
    return record ?? null
  }

  if (!wantsChangelog(include)) {
    result = await assembleData()
  } else {
    const { latestVersionUid, changelog } = await assembleSeedChangelog(
      trimmed,
      options,
      dataSource,
    )

    if (wantsData(include)) {
      const record = await assembleData()
      result = record ? { ...record, changelog } : null
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
      if (latestVersionUid) dependencies.refUIDs.push(latestVersionUid)
    }
    // Property changes on any version in the changelog change it.
    for (const entry of changelog) dependencies.refUIDs.push(entry.versionUid)
    dependencies = {
      refUIDs: [...new Set(dependencies.refUIDs)],
      ids: dependencies.ids,
    }
  }

  if (
    result &&
    shouldUseCache(options, allowCache) &&
    dataSource.kind === 'remote'
  ) {
    await getQueryCacheManager().setItem({
      record: result,
      optionsKey,
      dependencies,
      checkedAt: checkedAtFor(startedAt),
      seenChangeKeys: [],
      lastUpdated: startedAt,
    })
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
    return assembleSeedsWithDependencies(schemaName, seeds, options, ds)
  }

  const startedAt = nowSeconds()
  const { assembled, dataSource: used, useQueryCache } =
    await withAutoFallbackForCollection(mode, resolved.dataSource, run)

  if (shouldUseCache(options, useQueryCache) && used.kind === 'remote') {
    await writeThroughAssembled(assembled, buildAssembleOptionsKey(options), startedAt)
  }

  return assembled.records
}
