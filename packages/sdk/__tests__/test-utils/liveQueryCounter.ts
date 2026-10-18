import { vi } from 'vitest'
import { Observable } from 'rxjs'
import { BaseDb } from '@/db/Db/BaseDb'

type LiveQueryRecord = {
  sql: string
  params: unknown[]
  active: number
}

/**
 * Counts subscriptions to `BaseDb.liveQuery` observables while leaving the queries real: each call
 * goes to the actual implementation, and the returned observable is wrapped only to track how many
 * subscribers it has right now. Lets a test check that an entity's liveQueries are unsubscribed
 * when it is unloaded or destroyed.
 *
 * Install before the entity is created. Browser only: the Node DB's liveQuery is a stub, and Item
 * sets up its liveQueries only when `window` exists.
 */
export function countLiveQueries() {
  const records: LiveQueryRecord[] = []
  const original = BaseDb.liveQuery.bind(BaseDb)

  const spy = vi.spyOn(BaseDb, 'liveQuery').mockImplementation(((query: unknown) => {
    const record: LiveQueryRecord = { ...describeQuery(query), active: 0 }
    records.push(record)
    const inner = original(query as any)
    return new Observable((subscriber) => {
      record.active += 1
      const subscription = inner.subscribe(subscriber)
      return () => {
        record.active -= 1
        subscription.unsubscribe()
      }
    })
  }) as typeof BaseDb.liveQuery)

  const matching = ({ param, sql }: LiveQueryFilter) =>
    records.filter((r) => r.params.includes(param) && (!sql || sql.test(r.sql)))

  return {
    /** liveQuery calls matching `filter`. */
    calls: (filter: LiveQueryFilter) => matching(filter).length,
    /** Subscribers currently open on liveQueries matching `filter`. */
    active: (filter: LiveQueryFilter) => matching(filter).reduce((sum, r) => sum + r.active, 0),
    /** The SQL of open liveQueries matching `filter`, for failure messages. */
    activeSql: (filter: LiveQueryFilter) =>
      matching(filter)
        .filter((r) => r.active > 0)
        .map((r) => r.sql.replace(/\s+/g, ' ').trim()),
    restore: () => spy.mockRestore(),
  }
}

export type LiveQueryCounter = ReturnType<typeof countLiveQueries>

/** Selects liveQueries by a bound parameter (e.g. a seedLocalId) and, optionally, their SQL text. */
export type LiveQueryFilter = { param: string; sql?: RegExp }

/** SQL text and bound parameters of a liveQuery argument: an SQL tag function or a Drizzle query. */
function describeQuery(query: unknown): { sql: string; params: unknown[] } {
  if (typeof query === 'function') {
    let described = { sql: '', params: [] as unknown[] }
    const tag = (strings: TemplateStringsArray, ...params: unknown[]) => {
      described = { sql: strings.join('?'), params }
      return described
    }
    try {
      query(tag)
    } catch {
      // Not a tag function after all; leave it undescribed.
    }
    return described
  }
  const toSQL = (query as { toSQL?: () => { sql: string; params: unknown[] } } | null)?.toSQL
  if (typeof toSQL === 'function') {
    try {
      return toSQL.call(query)
    } catch {
      // Fall through.
    }
  }
  return { sql: '', params: [] }
}
