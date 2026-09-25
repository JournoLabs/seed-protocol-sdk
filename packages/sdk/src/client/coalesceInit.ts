/**
 * Coalesce overlapping async init calls onto one in-flight promise.
 * Skip when already successfully ready. Always clear in-flight on settle
 * so a failed init can be retried.
 */
export function createCoalescedAsync<T>(
  run: (arg: T) => Promise<void>,
  shouldSkip: (arg: T) => boolean,
): (arg: T) => Promise<void> {
  let inFlight: Promise<void> | null = null

  return (arg: T) => {
    if (inFlight) {
      return inFlight
    }
    if (shouldSkip(arg)) {
      return Promise.resolve()
    }
    const pending = run(arg).finally(() => {
      if (inFlight === pending) {
        inFlight = null
      }
    })
    inFlight = pending
    return pending
  }
}
