import debug from 'debug'

/**
 * Phase timings for item creates, finds and property saves, and ready waits that timed out but
 * were allowed to continue, under `DEBUG=seedSdk:timing`. Timing lines are `<label> <ms>ms` plus
 * any details, so an app can report where a slow call spent its time.
 */
export const timingLogger = debug('seedSdk:timing')

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Runs `fn` and logs how long it took (also when it throws). Costs nothing when the namespace is off. */
export async function timed<T>(label: string, fn: () => Promise<T>, details?: () => string): Promise<T> {
  if (!timingLogger.enabled) return fn()
  const start = now()
  let failed = false
  try {
    return await fn()
  } catch (error) {
    failed = true
    throw error
  } finally {
    const extra = details?.()
    timingLogger(`${label} ${Math.round(now() - start)}ms${failed ? ' (failed)' : ''}${extra ? ` ${extra}` : ''}`)
  }
}

/**
 * Database work counted while the namespace is on, so a timing line can say how much of its time
 * was the SQLite worker. Statements are the ones the SDK sends through the driver; their time runs
 * from send to result, so it includes the wait behind everything queued before them on the one
 * worker. Live-query runs are SQLocal reactive-query results (the first run and every re-run after
 * a write to a watched table), which go through the same worker but not through the driver.
 */
export const dbTimingCounters = {
  statements: 0,
  statementMs: 0,
  inFlight: 0,
  liveQueryRuns: 0,
  liveQueryFirstRuns: 0,
  liveQueryFirstRunMs: 0,
}

type DbCounterSnapshot = typeof dbTimingCounters

const snapshotCounters = (): DbCounterSnapshot => ({ ...dbTimingCounters })

/** Wraps a driver function so each call is counted while timing is on. */
export function countDbStatements<Args extends unknown[], R>(
  driver: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    if (!timingLogger.enabled) return driver(...args)
    const start = now()
    dbTimingCounters.inFlight += 1
    try {
      return await driver(...args)
    } finally {
      dbTimingCounters.inFlight -= 1
      dbTimingCounters.statements += 1
      dbTimingCounters.statementMs += now() - start
    }
  }
}

/** Starts the clock for one live query; call the result on each of its runs. */
export function countLiveQueryRuns(): () => void {
  if (!timingLogger.enabled) return () => {}
  const start = now()
  let first = true
  return () => {
    dbTimingCounters.liveQueryRuns += 1
    if (!first) return
    first = false
    dbTimingCounters.liveQueryFirstRuns += 1
    dbTimingCounters.liveQueryFirstRunMs += now() - start
  }
}

const describeDbDelta = (before: DbCounterSnapshot): string => {
  const after = dbTimingCounters
  const statements = after.statements - before.statements
  const statementMs = after.statementMs - before.statementMs
  const liveRuns = after.liveQueryRuns - before.liveQueryRuns
  const firstRuns = after.liveQueryFirstRuns - before.liveQueryFirstRuns
  const firstMs = after.liveQueryFirstRunMs - before.liveQueryFirstRunMs
  const parts = [`queued ${before.inFlight}`]
  if (statements) parts.push(`${statements} stmts avg ${Math.round(statementMs / statements)}ms`)
  if (liveRuns) parts.push(`${liveRuns} live runs`)
  if (firstRuns) parts.push(`${firstRuns} new live queries, first run avg ${Math.round(firstMs / firstRuns)}ms`)
  return `[db: ${parts.join(', ')}]`
}

/**
 * Like `timed`, and the line also says how many statements and live-query runs went through the
 * worker meanwhile (from any caller, since they share the queue) and how many statements were
 * already queued when it started.
 */
export async function timedDb<T>(label: string, fn: () => Promise<T>, details?: () => string): Promise<T> {
  if (!timingLogger.enabled) return fn()
  const before = snapshotCounters()
  return timed(label, fn, () => [details?.(), describeDbDelta(before)].filter(Boolean).join(' '))
}

/** Milliseconds since `start` (a `timingNow()` value), rounded. */
export const timingSince = (start: number): number => Math.round(now() - start)

export const timingNow = now

/**
 * Split timer for one multi-step call: `mark(step)` records the time since the previous mark, and
 * `log(label)` writes one line with the total and every step. Does nothing when timing is off.
 */
export function timingMarks(): { mark: (step: string) => void; log: (label: string) => void } {
  if (!timingLogger.enabled) return { mark: () => {}, log: () => {} }
  const start = now()
  const before = snapshotCounters()
  let last = start
  const steps: string[] = []
  return {
    mark: (step) => {
      const t = now()
      steps.push(`${step} ${Math.round(t - last)}`)
      last = t
    },
    log: (label) => {
      timingLogger(`${label} ${Math.round(now() - start)}ms: ${steps.join(', ')} ${describeDbDelta(before)}`)
    },
  }
}
