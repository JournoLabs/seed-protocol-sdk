import debug from 'debug'
import { gt, lt, sql } from 'drizzle-orm'
import type { Observable } from 'rxjs'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { entityChanges } from '@/seedSchema'
import { isLeaderTab } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:browser:db:changeFeed')

/**
 * One feed per tab over the entity_changes log (ADR 0020). A single reactive query watches
 * `max(seq)`; when it rises, the feed reads the new log rows and calls the listeners registered
 * for each changed row's seed. Loaded Items and ItemProperties register here instead of holding a
 * liveQuery each, so a write re-runs the reads of the entities it touched, not of every loaded one.
 *
 * Other tabs' writes arrive the same way: SQLocal's effects broadcast re-runs this tab's
 * `max(seq)` query.
 */

export type EntityChangeTable = 'seeds' | 'versions' | 'metadata'

export type ChangeWatch = {
  seedLocalId?: string | null
  seedUid?: string | null
  tables: EntityChangeTable[]
  /** Metadata rows count only for these property names; every metadata row counts when omitted. */
  propertyNames?: string[]
}

type Registration = {
  watch: ChangeWatch
  tables: Set<string>
  propertyNames?: Set<string>
  listener: () => void
}

type ChangeRow = { seq: number; tbl: string; seedLocalId: string | null; seedUid: string | null; propertyName: string | null }

/** Log rows older than this are pruned by the leader tab. */
export const ENTITY_CHANGES_RETENTION_MS = 10 * 60_000
/** The leader prunes at most this often. */
export const ENTITY_CHANGES_PRUNE_EVERY_MS = 60_000

type FeedDb = SqliteRemoteDatabase<Record<string, unknown>>
type LiveQuery = <T>(query: (sql: any) => any) => Observable<T[]>

const byLocalId = new Map<string, Set<Registration>>()
const byUid = new Map<string, Set<Registration>>()
const registrations = new Set<Registration>()

let feed: { db: FeedDb; unsubscribe: () => void } | undefined
let cursor = 0
let reading: Promise<void> | undefined
let readAgain = false
let lastPrunedAt = 0

const addTo = (map: Map<string, Set<Registration>>, key: string, registration: Registration) => {
  let set = map.get(key)
  if (!set) map.set(key, (set = new Set()))
  set.add(registration)
}

const removeFrom = (map: Map<string, Set<Registration>>, key: string, registration: Registration) => {
  const set = map.get(key)
  if (!set) return
  set.delete(registration)
  if (set.size === 0) map.delete(key)
}

/**
 * Calls `listener` after a committed write to one of `watch.tables` for the watched seed, matched
 * by local id or (case-insensitively) by uid. A read of the log that has several matching rows
 * calls it once. When the tab missed rows (its cursor is older than the oldest kept row), every
 * listener is called once. Returns the unregister function.
 */
export function watchEntityChanges(watch: ChangeWatch, listener: () => void): () => void {
  const registration: Registration = {
    watch,
    tables: new Set(watch.tables),
    propertyNames: watch.propertyNames ? new Set(watch.propertyNames) : undefined,
    listener,
  }
  const localId = watch.seedLocalId || undefined
  const uid = watch.seedUid ? watch.seedUid.toLowerCase() : undefined
  registrations.add(registration)
  if (localId) addTo(byLocalId, localId, registration)
  if (uid) addTo(byUid, uid, registration)
  return () => {
    registrations.delete(registration)
    if (localId) removeFrom(byLocalId, localId, registration)
    if (uid) removeFrom(byUid, uid, registration)
  }
}

/**
 * Watches `watch` and runs `read` once per dispatch, handing its result to `onRows`. A read that
 * finishes after a newer one started is dropped, so an older result never replaces a newer one.
 *
 * Pass `since` (the `changeFeedCursor()` taken before the caller's own initial read) to run `read`
 * once right away when the feed moved on in between: a change dispatched before this watch was
 * registered would otherwise be missed.
 */
export function watchEntityRows<T>(
  watch: ChangeWatch,
  read: () => Promise<T>,
  onRows: (rows: T) => void,
  options: { since?: number; onError?: (error: unknown) => void } = {},
): { unsubscribe: () => void } {
  let latest = 0
  let closed = false
  const run = () => {
    const token = ++latest
    read().then(
      (rows) => {
        if (closed || token !== latest) return
        onRows(rows)
      },
      (error) => {
        if (closed || token !== latest) return
        if (options.onError) options.onError(error)
        else logger('entity read failed', error)
      },
    )
  }
  const unregister = watchEntityChanges(watch, run)
  if (options.since !== undefined && cursor > options.since) run()
  return {
    unsubscribe: () => {
      closed = true
      unregister()
    },
  }
}

/** The seq of the newest log row this tab has dispatched. */
export function changeFeedCursor(): number {
  return cursor
}

/** Registered watches, for tests. */
export function activeChangeWatches(): ChangeWatch[] {
  return [...registrations].map((r) => r.watch)
}

const callAll = (targets: Iterable<Registration>) => {
  for (const registration of targets) {
    try {
      registration.listener()
    } catch (error) {
      logger('listener threw', error)
    }
  }
}

const dispatch = (rows: ChangeRow[]) => {
  const targets = new Set<Registration>()
  for (const row of rows) {
    const candidates = [
      ...(row.seedLocalId ? byLocalId.get(row.seedLocalId) ?? [] : []),
      ...(row.seedUid ? byUid.get(row.seedUid.toLowerCase()) ?? [] : []),
    ]
    for (const registration of candidates) {
      if (!registration.tables.has(row.tbl)) continue
      if (
        row.tbl === 'metadata' &&
        registration.propertyNames &&
        row.propertyName != null &&
        !registration.propertyNames.has(row.propertyName)
      ) {
        continue
      }
      targets.add(registration)
    }
  }
  callAll(targets)
}

const readNewRows = async (db: FeedDb) => {
  const rows: ChangeRow[] = await db
    .select({
      seq: entityChanges.seq,
      tbl: entityChanges.tbl,
      seedLocalId: entityChanges.seedLocalId,
      seedUid: entityChanges.seedUid,
      propertyName: entityChanges.propertyName,
    })
    .from(entityChanges)
    .where(gt(entityChanges.seq, cursor))
    .orderBy(entityChanges.seq)
  if (feed?.db !== db || rows.length === 0) return
  // Writers are serialized, so committed seqs have no holes: a missing first row was pruned.
  const missed = rows[0]!.seq > cursor + 1
  cursor = rows[rows.length - 1]!.seq
  if (missed) {
    logger(`cursor fell behind the log; notifying all ${registrations.size} watches`)
    callAll([...registrations])
  } else {
    dispatch(rows)
  }
  await maybePrune(db)
}

const maybePrune = async (db: FeedDb) => {
  const now = Date.now()
  if (!isLeaderTab() || now - lastPrunedAt < ENTITY_CHANGES_PRUNE_EVERY_MS) return
  lastPrunedAt = now
  try {
    await pruneEntityChanges(db, now)
  } catch (error) {
    logger('prune failed', error)
  }
}

/** Deletes log rows older than ENTITY_CHANGES_RETENTION_MS. Deleting doesn't raise max(seq), so it dispatches nothing. */
export async function pruneEntityChanges(db: FeedDb, now = Date.now()): Promise<void> {
  await db.delete(entityChanges).where(lt(entityChanges.at, now - ENTITY_CHANGES_RETENTION_MS))
}

/** Reads once at a time; an emission during a read makes it read once more. */
const scheduleRead = (db: FeedDb) => {
  if (reading) {
    readAgain = true
    return
  }
  reading = (async () => {
    try {
      do {
        readAgain = false
        await readNewRows(db)
      } while (readAgain && feed?.db === db)
    } catch (error) {
      logger('read failed', error)
    } finally {
      reading = undefined
    }
  })()
}

/**
 * Starts this tab's feed on `db` (once its migrations ran), at the newest seq allocated so far:
 * entities do their own initial read. A second call replaces the first feed.
 */
export async function startChangeFeed(db: FeedDb, liveQuery: LiveQuery): Promise<void> {
  stopChangeFeed()
  // sqlite_sequence keeps the last seq even when pruning emptied the table.
  const [row] = await db.all<{ seq: number | null }>(
    sql`SELECT seq FROM sqlite_sequence WHERE name = 'entity_changes'`,
  )
  cursor = Number(row?.seq ?? 0)
  const subscription = liveQuery<{ seq: number | null }>(
    (tag: any) => tag`SELECT max(seq) AS seq FROM entity_changes`,
  ).subscribe({
    next: ([latest]) => {
      if (latest?.seq != null && Number(latest.seq) > cursor) scheduleRead(db)
    },
    error: (error) => logger('feed query failed', error),
  })
  feed = { db, unsubscribe: () => subscription.unsubscribe() }
  logger(`started at seq ${cursor}`)
}

export function stopChangeFeed(): void {
  feed?.unsubscribe()
  feed = undefined
  readAgain = false
}

/** Tests only: drops every watch and the prune clock. */
export function resetChangeFeedForTests(): void {
  registrations.clear()
  byLocalId.clear()
  byUid.clear()
  lastPrunedAt = 0
}
