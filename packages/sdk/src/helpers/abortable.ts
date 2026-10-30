/**
 * Settles with `work`, or rejects with `signal.reason` as soon as `signal` aborts. The work itself
 * keeps going, so use this for waits whose result can be dropped (a network read), not for writes.
 */
export function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}
