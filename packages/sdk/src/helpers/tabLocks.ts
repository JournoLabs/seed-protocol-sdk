/**
 * Cross-tab exclusive sections, using the Web Locks API. All tabs of an origin share one SQLite
 * database and OPFS tree; the browser releases a tab's locks when it closes or crashes, so a lock
 * can't go stale. See docs/MULTI_TAB.md.
 *
 * Node has Web Locks from 24.5, scoped to the process. Where they're missing (older Node, old
 * browsers), sections still run one at a time within this JS realm (see `withProcessLock`), which
 * covers a single Node process but not other tabs or worker threads.
 * Not re-entrant: requesting a name the caller already holds waits forever, so take each lock
 * only at the outermost call site.
 */

/** Long enough for a slow init in another tab; short enough that a hung tab doesn't block forever. */
export const TAB_LOCK_WAIT_TIMEOUT_MS = 60_000

/**
 * - `migrate`: schema migrations and one-time data fixes in `prepareDb`.
 * - `init`: client init steps that check for rows and then insert them.
 */
export type SeedDbLockScope = 'migrate' | 'init'

export function seedDbLockName(scope: SeedDbLockScope, filesDir: string): string {
  return `seed:${scope}:${filesDir}/db/seed.db`
}

/** `withTabLock` on the database under `filesDir`; runs `fn` directly when there's no `filesDir` yet. */
export function withSeedDbLock<T>(
  scope: SeedDbLockScope,
  filesDir: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return filesDir ? withTabLock(seedDbLockName(scope, filesDir), fn) : fn()
}

export class TabLockTimeoutError extends Error {
  readonly code = 'TAB_LOCK_TIMEOUT' as const

  constructor(readonly lockName: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for another tab to release "${lockName}".`)
    this.name = 'TabLockTimeoutError'
  }
}

export async function withTabLock<T>(
  name: string,
  fn: () => Promise<T>,
  { timeoutMs = TAB_LOCK_WAIT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return withProcessLock(name, fn, { timeoutMs })

  try {
    // The timeout bounds the wait only; once granted, fn runs to completion. Infinity waits for as
    // long as the holder runs (it can't outlive its tab).
    const signal = Number.isFinite(timeoutMs) ? AbortSignal.timeout(timeoutMs) : undefined
    return await locks.request(name, { mode: 'exclusive', signal }, fn)
  } catch (error) {
    if ((error as DOMException | null)?.name === 'TimeoutError') {
      throw new TabLockTimeoutError(name, timeoutMs)
    }
    throw error
  }
}

/**
 * Runs `fn` holding lock `name` only if no one holds it or waits for it now; otherwise runs nothing
 * and returns `{ acquired: false }`. For work that has something else to do meanwhile (the outbox
 * drainer).
 */
export async function tryWithTabLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) {
    if (processLockTails.has(name)) return { acquired: false }
    return { acquired: true, value: await withProcessLock(name, fn) }
  }
  return locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) =>
    lock ? { acquired: true as const, value: await fn() } : { acquired: false as const },
  )
}

/** Tail of each name's queue: resolves once every section queued so far has finished or given up. */
const processLockTails = new Map<string, Promise<void>>()

/**
 * The `withTabLock` fallback without Web Locks: an exclusive, first-come-first-served lock per name
 * within this JS realm. Like Web Locks, `timeoutMs` bounds the wait only, and a waiter that times
 * out doesn't let later waiters in before the current holder finishes.
 */
export async function withProcessLock<T>(
  name: string,
  fn: () => Promise<T>,
  { timeoutMs = TAB_LOCK_WAIT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<T> {
  const previous = processLockTails.get(name) ?? Promise.resolve()
  let release!: () => void
  const done = new Promise<void>((resolve) => (release = resolve))
  const tail = previous.then(() => done)
  processLockTails.set(name, tail)
  void tail.then(() => {
    if (processLockTails.get(name) === tail) processLockTails.delete(name)
  })

  try {
    await waitForTurn(previous, name, timeoutMs)
  } catch (error) {
    release()
    throw error
  }
  try {
    return await fn()
  } finally {
    release()
  }
}

function waitForTurn(previous: Promise<void>, name: string, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs)) return previous
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TabLockTimeoutError(name, timeoutMs)), timeoutMs)
  })
  return Promise.race([previous, timedOut]).finally(() => clearTimeout(timer))
}
