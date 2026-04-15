export type FormatSeedJsonOptions = {
  /** Max object/array nesting; default 6 */
  maxDepth?: number
  /** Truncate long strings in the output; default 50_000 */
  maxStringLength?: number
  /** Passed to JSON.stringify; default 2 */
  space?: string | number
}

function truncateString(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

function looksLikeJsonObjectOrArray(s: string): boolean {
  const t = s.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

function limitDepth(
  value: unknown,
  maxDepth: number,
  maxStringLength: number,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (typeof value === 'function') {
    return '[Function]'
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    return truncateString(value, maxStringLength)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  if (depth >= maxDepth) {
    return '[Max depth]'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map((item) => limitDepth(item, maxDepth, maxStringLength, depth + 1, seen))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = limitDepth(v, maxDepth, maxStringLength, depth + 1, seen)
  }
  return out
}

/**
 * Format a value as indented JSON text for read-only display (no eval).
 * Handles JSON-looking strings (parse attempt), depth limits, long strings, BigInt, and circular refs.
 */
export function formatSeedJson(value: unknown, options?: FormatSeedJsonOptions): string {
  const maxDepth = options?.maxDepth ?? 6
  const maxStringLength = options?.maxStringLength ?? 50_000
  const space = options?.space ?? 2

  if (value === undefined) {
    return 'undefined'
  }
  if (value === null) {
    return 'null'
  }

  let toSerialize: unknown = value
  if (typeof value === 'string') {
    if (looksLikeJsonObjectOrArray(value)) {
      try {
        toSerialize = JSON.parse(value) as unknown
      } catch {
        return truncateString(value, maxStringLength)
      }
    } else {
      return truncateString(value, maxStringLength)
    }
  }

  const limited = limitDepth(toSerialize, maxDepth, maxStringLength, 0, new WeakSet())

  try {
    return JSON.stringify(limited, null, space)
  } catch {
    return '[Unserializable JSON]'
  }
}
