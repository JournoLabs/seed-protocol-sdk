/**
 * Freezes `value` and everything reachable from it, children before parents, so a frozen object's
 * subtree is already frozen and is skipped (records share related-seed clones, and write-through
 * freezes the same nested objects more than once). Typed arrays can't be frozen and are left as is.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  if (ArrayBuffer.isView(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
