/**
 * Retries background work that failed because the device is (probably) offline: the startup EAS
 * schema lookup and automatic EAS syncs. Without it, a session that starts offline never syncs.
 *
 * A retry waits for the browser's `online` event while `navigator.onLine` is false, and otherwise
 * backs off on a timer (15 s doubling to 5 min, which also covers Node and a reachable network
 * with an unreachable indexer). Only one retry per task is pending at a time. Timers don't keep a
 * Node process alive. `client.stop()` cancels every pending retry.
 *
 * Off under `NODE_ENV=test`, where a late retry would sync in the middle of another test; tests that
 * exercise retries pass `enabled` or call {@link setRetriesWhenOnlineEnabled}.
 */
const DEFAULT_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000]

export type RetryWhenOnline = {
  /** Schedules the next attempt, unless one is already pending. */
  schedule: () => void
  /** The work succeeded: the next failure starts over from the shortest delay. */
  succeeded: () => void
  cancel: () => void
  readonly pending: boolean
}

const all = new Set<RetryWhenOnline>()

const isTestEnv = (): boolean =>
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'

let enabledOverride: boolean | undefined

/** Turns retries without an explicit `enabled` on or off; `undefined` restores the default. */
export function setRetriesWhenOnlineEnabled(enabled: boolean | undefined): void {
  enabledOverride = enabled
}

const isOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false

const onlineTarget = (): { addEventListener: Function; removeEventListener: Function } | undefined =>
  typeof globalThis.addEventListener === 'function' ? (globalThis as any) : undefined

export function createRetryWhenOnline(
  run: () => void,
  options: { delaysMs?: number[]; enabled?: boolean } = {},
): RetryWhenOnline {
  const delaysMs = options.delaysMs ?? DEFAULT_DELAYS_MS
  const isEnabled = () => options.enabled ?? enabledOverride ?? !isTestEnv()
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let onOnline: (() => void) | undefined

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (onOnline) onlineTarget()?.removeEventListener('online', onOnline)
    onOnline = undefined
  }

  const retry: RetryWhenOnline = {
    schedule() {
      if (!isEnabled() || timer !== undefined || onOnline) return
      const fire = () => {
        clear()
        run()
      }
      const target = onlineTarget()
      if (isOffline() && target) {
        onOnline = fire
        target.addEventListener('online', onOnline)
        return
      }
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)]!
      attempt += 1
      timer = setTimeout(fire, delay)
      ;(timer as { unref?: () => void }).unref?.()
    },
    succeeded() {
      attempt = 0
    },
    cancel() {
      clear()
      attempt = 0
    },
    get pending() {
      return timer !== undefined || onOnline !== undefined
    },
  }
  all.add(retry)
  return retry
}

/** Cancels every pending retry (client.stop()). */
export function cancelAllRetriesWhenOnline(): void {
  for (const retry of all) retry.cancel()
}
