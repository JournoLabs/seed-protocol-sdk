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
