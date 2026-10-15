/**
 * Detect SQLite UNIQUE constraint failures across better-sqlite3 and drizzle/wasm wrappers.
 * Drizzle often surfaces `Failed query: insert into...` without "UNIQUE constraint" on message,
 * with the real SQLITE_CONSTRAINT_UNIQUE on cause / nested error.
 */
export function isSqliteUniqueConstraintError(error: unknown): boolean {
  const seen = new Set<unknown>()
  const queue: unknown[] = [error]

  while (queue.length > 0) {
    const current = queue.shift()
    if (current == null || seen.has(current)) continue
    seen.add(current)

    if (typeof current === 'string') {
      if (matchesUniqueConstraintText(current)) return true
      continue
    }

    if (typeof current !== 'object') continue

    const err = current as Record<string, unknown>

    const code = err.code
    if (
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      code === 2067 ||
      code === '2067'
    ) {
      return true
    }

    for (const key of ['message', 'msg', 'stack'] as const) {
      const raw = err[key]
      const value = key === 'stack' && typeof raw === 'string' ? stackWithoutFrames(raw) : raw
      if (typeof value === 'string' && matchesUniqueConstraintText(value)) {
        return true
      }
    }

    // Drizzle / wasm often nest the real SQLite error
    for (const key of ['cause', 'reason', 'error', 'originalError', 'err'] as const) {
      if (err[key] != null) queue.push(err[key])
    }
  }

  return false
}

function matchesUniqueConstraintText(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('unique constraint') ||
    lower.includes('sqlite_constraint_unique') ||
    (lower.includes('constraint failed') && lower.includes('unique')) ||
    /\brc\s*=\s*2067\b/i.test(text) ||
    (text.includes('2067') && lower.includes('constraint'))
  )
}

/**
 * A stack's message lines without its frames. Frames hold file names and line:column numbers, so
 * a frame in a file named like this one, with a 2067 in its position or URL timestamp, would match.
 */
function stackWithoutFrames(stack: string): string {
  return stack
    .split('\n')
    .filter((line) => !/^\s*at\s/.test(line) && !/@\S*:\d+:\d+\s*$/.test(line))
    .join('\n')
}
