/**
 * Cross-tab exclusive sections, using the Web Locks API. All tabs of an origin share one SQLite
 * database and OPFS tree; the browser releases a tab's locks when it closes or crashes, so a lock
 * can't go stale. See docs/MULTI_TAB.md.
 *
 * Where Web Locks are missing, `fn` runs directly. (Node has them too, scoped to the process.)
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
  if (!locks) return fn()

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
