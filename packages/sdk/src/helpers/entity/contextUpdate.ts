/**
 * The `updateContext` rule every entity machine uses: the event's keys (all but `type`) are set on
 * the context, including keys the context doesn't have yet and `undefined` values (which clear a
 * field). Arrays are copied so a caller mutating its array can't change the context. Keys starting
 * with `_` are internal: an update made only of them neither revalidates nor counts as an edit.
 */

type ContextEvent = { type: string } & Record<string, unknown>

export function contextUpdates(event: ContextEvent | object): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (key === 'type') continue
    updates[key] = Array.isArray(value) ? [...value] : value
  }
  return updates
}

/** Whether every key the update sets is internal (`_`-prefixed). */
export function isInternalUpdate(event: ContextEvent | object): boolean {
  return Object.keys(event).every((key) => key === 'type' || key.startsWith('_'))
}

export function applyContextUpdate<C extends object>(context: C, event: ContextEvent | object): C {
  return { ...context, ...contextUpdates(event) } as C
}

/**
 * Whether any public key the update sets now differs from `originals` (objects compared as JSON).
 * Undefined when there are no originals yet (nothing loaded to compare against).
 */
export function differsFromOriginals(
  originals: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  event: ContextEvent | object,
  ignore: readonly string[] = [],
): boolean | undefined {
  if (!originals) return undefined
  return Object.keys(event).some((key) => {
    if (key === 'type' || key.startsWith('_') || ignore.includes(key)) return false
    const value = next[key]
    const original = originals[key]
    if (typeof value === 'object' && value !== null && typeof original === 'object' && original !== null) {
      return JSON.stringify(value) !== JSON.stringify(original)
    }
    return value !== original
  })
}
