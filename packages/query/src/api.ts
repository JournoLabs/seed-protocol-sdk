import { keepAttestationsFromRefAttester } from '@seedprotocol/eas'
import { initializeQueryPlatform } from './bootstrap.js'
import {
  assembleSeedRecords,
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
  findChangedItems,
  findChangedSeeds,
  nowSeconds,
  type ItemChangeCheck,
} from './cache/changes.js'
import type { CachedCollectionData, CachedItemData, CachedRecordMeta } from './cache/types.js'
import {
  normalizeSourceMode,
  resolveQuerySource,
  getRemoteQueryDataSource,
} from './source/index.js'
import type { QueryDataSource, SeedListFilter } from './source/types.js'
import {
  toSeedPropertyAttestation,
  type SeedAttestations,
  type SeedPropertyAttestation,
} from './seedAttestations.js'
import type {
  AssembleOptions,
  GetSeedOptions,
  GetSeedResult,
  GetSeedsOptions,
  QueryBySchemaOptions,
  QueryBySchemaResult,
  AttestationLike,
  SeedRecord,
  VersionPin,
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
  filter: SeedListFilter,
  options: AssembleOptions | undefined,
  dataSource: QueryDataSource,
): Promise<Assembled> {
  const seeds = await dataSource.listSeedsBySchemaName(schemaName, { limit, skip, ...filter })
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
 * What to check for changes on a cached collection: every cached seed's dependencies, minus the
 * seed's own uid in `ids`. The seed list leaves out revoked seeds, so a revoked listed seed drops
 * out of the list without a check; a revoked related seed is still checked through its parent.
 */
function collectionChangeChecks(cached: CachedCollectionData): Map<string, SeedDependencies> {
  const checks = new Map<string, SeedDependencies>()
  for (const item of cached.items) {
    const deps = cached.meta[item.seedUid]?.dependencies ?? NO_DEPENDENCIES
    checks.set(item.seedUid, {
      refUIDs: deps.refUIDs,
      ids: deps.ids.filter((uid) => uid !== item.seedUid),
    })
  }
  return checks
}

/**
 * The schema's first `limit` seeds, newest first, from the collection cache where they haven't
 * changed. The seed list itself is always fetched (it shows new and revoked seeds). Cached seeds
 * are checked for changes alongside it (see findChangedSeeds), all of them rather than only the
 * listed ones, so a warm read is one round; only new or changed seeds are assembled. The TTL
 * counts from the last full assembly.
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
  const checks = cached ? collectionChangeChecks(cached) : undefined
  const [listed, found] = await Promise.all([
    dataSource.listSeedsBySchemaName(schemaName, { limit, skip: 0 }),
    cached && checks ? findChangedSeeds(dataSource, checks, cached) : undefined,
  ])

  const cachedBySeedUid = new Map(cached?.items.map((item) => [item.seedUid, item]) ?? [])
  let changed = new Set<string>()
  let seenChangeKeys: string[] = []
  if (cached && checks) {
    if (found) {
      changed = found.changed
      seenChangeKeys = found.seenChangeKeys
    } else {
      changed = new Set(checks.keys())
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
  // The cached records (frozen outside production), so a fresh result behaves like a cache hit.
  return { items: stored ? [...stored.items] : items, limit, skip: 0, etag: stored?.etag }
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

/**
 * Lowercase `0x` + 40 hex for each entry that is an address (with or without `0x`, any case),
 * without duplicates. Null when none is.
 */
export function normalizeAttesters(attesters: readonly string[]): string[] | null {
  const out = new Set<string>()
  for (const attester of attesters) {
    const hex = attester.trim().toLowerCase().replace(/^0x/, '')
    if (/^[0-9a-f]{40}$/.test(hex)) out.add(`0x${hex}`)
  }
  return out.size > 0 ? [...out] : null
}

/**
 * The schema's Seeds as SeedRecords. Like `getSeed` and `getSeeds`, a Seed with no
 * Version from its attester, or whose Versions were all revoked, is left out; `limit` and `skip`
 * count listed Seeds, so a page can come back shorter than `limit`.
 */
export async function queryBySchema(
  schemaName: string,
  options?: QueryBySchemaOptions,
): Promise<QueryBySchemaResult> {
  await initializeQueryPlatform({ source: normalizeSourceMode(options?.source) })
  const limit = options?.limit ?? 100
  const skip = options?.skip ?? 0
  const mode = normalizeSourceMode(options?.source)
  const resolved = resolveQuerySource(mode)
  const optionsKey = buildAssembleOptionsKey(options)

  const filter: SeedListFilter = {}
  if (options?.uidPrefix !== undefined) {
    const uidPrefix = normalizeUidPrefix(options.uidPrefix)
    if (!uidPrefix) return { items: [], limit, skip }
    filter.uidPrefix = uidPrefix
  }
  if (options?.attesters !== undefined) {
    const attesters = normalizeAttesters(options.attesters)
    if (!attesters) return { items: [], limit, skip }
    filter.attesters = attesters
  }
  const filtered = filter.uidPrefix !== undefined || filter.attesters !== undefined

  const runAssemble = (ds: QueryDataSource): Promise<Assembled> =>
    fetchAndAssemble(schemaName, limit, skip, filter, options, ds)

  // Collection cache only for the remote, skip=0 working set (a filtered listing isn't one)
  if (
    !filtered &&
    shouldUseCache(options, resolved.useQueryCache) &&
    skip === 0 &&
    resolved.dataSource.kind === 'remote'
  ) {
    const cache = getQueryCacheManager()
    const lockKey = `${schemaName}\n${optionsKey}\n${limit}`
    const maxAge = options?.maxAge ?? cache.getConfig().maxAge ?? 0
    return cache.withRefreshLock(lockKey, async () => {
      if (maxAge > 0) {
        const recent = await cache.getCheckedCollection(lockKey, schemaName, optionsKey, maxAge)
        if (recent) return { items: [...recent.items], limit, skip: 0, etag: recent.etag }
      }
      const result = await refreshCollection(
        schemaName,
        limit,
        options,
        optionsKey,
        resolved.dataSource,
      )
      if (result.etag) cache.markCollectionChecked(lockKey, result.etag)
      return result
    })
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
 * Cached items, by seedUid, for the seeds whose dependencies haven't changed since each was last
 * checked (one change request for all; see findChangedItems). Changed items are dropped so the
 * caller assembles them again.
 */
async function getUnchangedCachedItems(
  requests: Array<{ seedUid: string; optionsKey: string }>,
  dataSource: QueryDataSource,
): Promise<Map<string, GetSeedResult>> {
  const cache = getQueryCacheManager()
  const cachedBySeedUid = new Map<string, CachedItemData>()
  await Promise.all(
    requests.map(async ({ seedUid, optionsKey }) => {
      const cached = await cache.getItem(seedUid, optionsKey)
      if (cached) cachedBySeedUid.set(seedUid, cached)
    }),
  )
  const hits = new Map<string, GetSeedResult>()
  if (cachedBySeedUid.size === 0) return hits

  const startedAt = nowSeconds()
  const checks = new Map<string, ItemChangeCheck>()
  for (const [seedUid, cached] of cachedBySeedUid) checks.set(seedUid, cached)
  const found = await findChangedItems(dataSource, checks)
  for (const [seedUid, cached] of cachedBySeedUid) {
    if (!found || found.changed.has(seedUid)) {
      await cache.clearItem(seedUid, cached.optionsKey)
      continue
    }
    if (checkWindowAged(cached, startedAt)) {
      await cache.setItem({
        ...cached,
        checkedAt: checkedAtFor(startedAt),
        seenChangeKeys: found.seenChangeKeys.get(seedUid) ?? [],
      })
    }
    hits.set(seedUid, cached.record)
  }
  return hits
}

async function getUnchangedCachedItem(
  seedUid: string,
  optionsKey: string,
  dataSource: QueryDataSource,
): Promise<GetSeedResult | null> {
  const hits = await getUnchangedCachedItems([{ seedUid, optionsKey }], dataSource)
  return hits.get(seedUid) ?? null
}

/**
 * UIDs (lowercase) of `seeds` that have a Version from the seed's attester, revoked ones included.
 * A seed without one has never been published: getSeed and getSeeds treat it as not found.
 */
function seedUidsWithVersions(seeds: AttestationLike[], versions: AttestationLike[]): Set<string> {
  return new Set(
    keepAttestationsFromRefAttester(versions, seeds).map((version) => version.refUID.toLowerCase()),
  )
}

/** The pin in `options`, if it names a version or a time. */
function pinOf(options: VersionPin | undefined): VersionPin | undefined {
  if (options?.versionUid === undefined && options?.asOf === undefined) return undefined
  return { versionUid: options.versionUid, asOf: options.asOf }
}

export async function getSeed(
  seedUid: string,
  options?: GetSeedOptions,
): Promise<GetSeedResult | null> {
  await initializeQueryPlatform({ source: normalizeSourceMode(options?.source) })
  if (!seedUid || typeof seedUid !== 'string' || seedUid.trim() === '') {
    return null
  }

  // Read lowercase, like getSeeds (EAS indexes UIDs lowercase and matches them case-sensitively).
  const trimmed = seedUid.trim().toLowerCase()
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

  /** The seed, or null when the source doesn't have it or it has no Versions. */
  const fetchPublishedSeed = async (ds: QueryDataSource) => {
    const [found, foundVersions] = await fetchSeedAndVersions(ds)
    const published = found && seedUidsWithVersions([found], foundVersions).has(trimmed)
    return [published ? found : null, foundVersions] as const
  }

  const startedAt = nowSeconds()
  let [seed, versions] = await fetchPublishedSeed(dataSource)

  // auto: local miss (or a local seed with no Versions) → remote
  if (!seed && mode === 'auto' && dataSource.kind === 'local') {
    dataSource = getRemoteQueryDataSource()
    allowCache = true
    if (shouldUseCache(options, allowCache)) {
      const cached = await getUnchangedCachedItem(trimmed, optionsKey, dataSource)
      if (cached) return cached
    }
    ;[seed, versions] = await fetchPublishedSeed(dataSource)
  }

  if (!seed) return null

  const schemaName = seed.schema?.schemaNames?.[0]?.name
  if (!schemaName) return null

  let result: GetSeedResult | null = null
  let dependencies: SeedDependencies = { refUIDs: [trimmed], ids: [trimmed] }

  const pin = pinOf(options)
  const assembleData = async (): Promise<SeedRecord | null> => {
    const assembled = await assembleSeedRecords([seed], options, dataSource, {
      schemaName,
      versions,
      pins: pin && new Map([[trimmed, pin]]),
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
    const stored = await getQueryCacheManager().setItem({
      record: result,
      optionsKey,
      dependencies,
      checkedAt: checkedAtFor(startedAt),
      seenChangeKeys: [],
      lastUpdated: startedAt,
    })
    // The cached record (frozen outside production), so a fresh result behaves like a cache hit.
    if (stored) result = stored.record
  }

  return result
}

/**
 * Many seeds, of any schemas, keyed by UID as given (first spelling of each, in order). Seeds
 * not found, revoked, or without their pinned version are left out. Uncached seeds are
 * assembled together, in one set of requests (see assembleSeedRecords), and cached ones are
 * checked for changes in one request; records are shared with `getSeed` (same item cache).
 * A seed can be read at one version per call.
 */
export async function getSeeds(
  seedUids: readonly string[],
  options?: GetSeedsOptions,
): Promise<Map<string, SeedRecord>> {
  await initializeQueryPlatform({ source: normalizeSourceMode(options?.source) })

  // Read lowercase (EAS indexes UIDs lowercase and matches them case-sensitively); keyed as given.
  const givenByUid = new Map<string, string>()
  for (const given of seedUids) {
    if (typeof given !== 'string' || given.trim() === '') continue
    const uid = given.trim().toLowerCase()
    if (!givenByUid.has(uid)) givenByUid.set(uid, given.trim())
  }
  const requested = [...givenByUid.keys()]
  if (requested.length === 0) return new Map()

  const pins = new Map<string, VersionPin>()
  for (const [uid, pin] of options?.pins ?? []) {
    const active = pinOf(pin)
    if (active) pins.set(uid.trim().toLowerCase(), active)
  }
  const optionsKeyFor = (seedUid: string) =>
    buildAssembleOptionsKey({ ...options, ...pins.get(seedUid) })

  const mode = normalizeSourceMode(options?.source)
  const resolved = resolveQuerySource(mode)
  const found = new Map<string, SeedRecord>()

  /** Reads `uids` from `dataSource` into `found`; returns the ones whose seed it doesn't have. */
  const readFrom = async (
    dataSource: QueryDataSource,
    allowCache: boolean,
    uids: string[],
  ): Promise<string[]> => {
    const useCache = shouldUseCache(options, allowCache) && dataSource.kind === 'remote'
    let toFetch = uids
    if (useCache) {
      const hits = await getUnchangedCachedItems(
        uids.map((seedUid) => ({ seedUid, optionsKey: optionsKeyFor(seedUid) })),
        dataSource,
      )
      for (const [seedUid, record] of hits) found.set(seedUid, record)
      toFetch = uids.filter((uid) => !hits.has(uid))
    }
    if (toFetch.length === 0) return []

    const startedAt = nowSeconds()
    const [seeds, versions] = await Promise.all([
      dataSource.getSeedsByUids(toFetch),
      dataSource.getVersionsForSeeds(toFetch, { includeRevoked: true }),
    ])
    // Like getSeed: a seed with no Versions counts as missing.
    const published = seedUidsWithVersions(seeds, versions)
    const seedByUid = new Map(
      seeds.filter((seed) => published.has(seed.id.toLowerCase())).map((seed) => [seed.id.toLowerCase(), seed]),
    )
    const missing = toFetch.filter((uid) => !seedByUid.has(uid))
    // Like getSeed: a seed without a schema name isn't assembled.
    const toAssemble = toFetch
      .map((uid) => seedByUid.get(uid))
      .filter((seed): seed is AttestationLike => !!seed?.schema?.schemaNames?.[0]?.name)

    const assembled = await assembleSeedRecords(toAssemble, options, dataSource, {
      versions,
      pins,
    })
    for (const record of assembled.records) {
      let result: SeedRecord = record
      if (useCache) {
        const stored = await getQueryCacheManager().setItem({
          record,
          optionsKey: optionsKeyFor(record.seedUid.toLowerCase()),
          dependencies: assembled.dependencies.get(record.seedUid) ?? {
            refUIDs: [record.seedUid],
            ids: [record.seedUid],
          },
          checkedAt: checkedAtFor(startedAt),
          seenChangeKeys: [],
          lastUpdated: startedAt,
        })
        // The cached record (frozen outside production), so a fresh result behaves like a cache hit.
        if (stored) result = stored.record
      }
      found.set(record.seedUid.toLowerCase(), result)
    }
    return missing
  }

  const missing = await readFrom(resolved.dataSource, resolved.useQueryCache, requested)
  // auto: seeds the local source doesn't have → remote
  if (missing.length > 0 && mode === 'auto' && resolved.dataSource.kind === 'local') {
    await readFrom(getRemoteQueryDataSource(), true, missing)
  }

  const result = new Map<string, SeedRecord>()
  for (const [uid, given] of givenByUid) {
    const record = found.get(uid)
    if (record) result.set(given, record)
  }
  return result
}

/**
 * Each seed's record with the property attestations it is assembled from, as attested: EAS field
 * name, type and value. For exports that need the on-chain types (`@seedprotocol/rdf`), which a
 * `SeedRecord` doesn't keep. Same seeds, versions and pins as getSeeds; records are assembled with
 * `relations: 'uids'`, without storage hydration, and never read from or written to the query cache.
 * Keyed as given; seeds that aren't found are left out.
 */
export async function getSeedAttestations(
  seedUids: readonly string[],
  options?: Pick<GetSeedsOptions, 'source' | 'pins'>,
): Promise<Map<string, SeedAttestations>> {
  await initializeQueryPlatform({ source: normalizeSourceMode(options?.source) })

  const givenByUid = new Map<string, string>()
  for (const given of seedUids) {
    if (typeof given !== 'string' || given.trim() === '') continue
    const uid = given.trim().toLowerCase()
    if (!givenByUid.has(uid)) givenByUid.set(uid, given.trim())
  }
  const requested = [...givenByUid.keys()]
  if (requested.length === 0) return new Map()

  const pins = new Map<string, VersionPin>()
  for (const [uid, pin] of options?.pins ?? []) {
    const active = pinOf(pin)
    if (active) pins.set(uid.trim().toLowerCase(), active)
  }

  const mode = normalizeSourceMode(options?.source)
  const resolved = resolveQuerySource(mode)
  const found = new Map<string, SeedAttestations>()

  /** Reads `uids` from `dataSource` into `found`; returns the ones whose seed it doesn't have. */
  const readFrom = async (dataSource: QueryDataSource, uids: string[]): Promise<string[]> => {
    const [seeds, versions] = await Promise.all([
      dataSource.getSeedsByUids(uids),
      dataSource.getVersionsForSeeds(uids, { includeRevoked: true }),
    ])
    const published = seedUidsWithVersions(seeds, versions)
    const seedByUid = new Map(
      seeds.filter((seed) => published.has(seed.id.toLowerCase())).map((seed) => [seed.id.toLowerCase(), seed]),
    )
    const toAssemble = uids
      .map((uid) => seedByUid.get(uid))
      .filter((seed): seed is AttestationLike => !!seed?.schema?.schemaNames?.[0]?.name)
    const assembled = await assembleSeedRecords(
      toAssemble,
      { relations: 'uids', hydrateStorage: false },
      dataSource,
      { versions, pins },
    )
    for (const record of assembled.records) {
      const properties = (assembled.properties.get(record.seedUid) ?? [])
        .map(toSeedPropertyAttestation)
        .filter((p): p is SeedPropertyAttestation => p !== null)
      found.set(record.seedUid.toLowerCase(), { record, properties })
    }
    return uids.filter((uid) => !seedByUid.has(uid))
  }

  const missing = await readFrom(resolved.dataSource, requested)
  // auto: seeds the local source doesn't have → remote
  if (missing.length > 0 && mode === 'auto' && resolved.dataSource.kind === 'local') {
    await readFrom(getRemoteQueryDataSource(), missing)
  }

  const result = new Map<string, SeedAttestations>()
  for (const [uid, given] of givenByUid) {
    const entry = found.get(uid)
    if (entry) result.set(given, entry)
  }
  return result
}

/**
 * Query seeds of a schema created within a calendar month, in UTC.
 * No collection cache; may write-through to item cache when remote.
 */
export async function queryBySchemaForMonth(
  schemaName: string,
  year: number,
  month: number,
  options?: AssembleOptions,
): Promise<SeedRecord[]> {
  await initializeQueryPlatform({ source: normalizeSourceMode(options?.source) })
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
