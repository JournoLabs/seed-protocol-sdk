/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight. Results keep the input order.
 * Rejects with the first error (by time); after that no new calls start, though calls already in
 * flight run to completion.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let next = 0
  let failed = false

  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index]!, index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}
