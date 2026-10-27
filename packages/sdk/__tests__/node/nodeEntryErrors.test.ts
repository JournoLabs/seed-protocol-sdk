// @vitest-environment node
/**
 * `@seedprotocol/sdk/node` exports every error class the main entry does, so a Node app that imports
 * from `./node` can `instanceof` what the SDK throws. Browser-only errors are left out.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Thrown only by the browser's OPFS and ZenFS mount. Tab locks are not here: on Node, `withTabLock`
 * waits through Web Locks (24.5+) or the in-process fallback, and both throw TabLockTimeoutError.
 */
const BROWSER_ONLY = new Set(['DatabaseNotPersistentError', 'FileSystemLockedError', 'UnsupportedBrowserError'])

/** Names ending in `Error` that the main entry exports as values (not `type` exports). */
const mainEntryErrorNames = (): string[] => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/index.ts'), 'utf-8')
  const names = new Set<string>()
  for (const [, block] of source.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const part of block!.split(',')) {
      const spec = part.trim()
      if (!spec || spec.startsWith('type ')) continue
      const name = spec.split(/\s+as\s+/).pop()!.trim()
      if (/^[A-Z]\w*Error$/.test(name)) names.add(name)
    }
  }
  return [...names].sort()
}

describe('@seedprotocol/sdk/node error exports', () => {
  it('exports every error class the main entry exports, apart from browser-only ones', async () => {
    const nodeEntry = (await import('@/node/index')) as Record<string, unknown>
    const expected = mainEntryErrorNames().filter((name) => !BROWSER_ONLY.has(name))
    expect(expected).toContain('EntityUnloadedError')

    const missing = expected.filter((name) => typeof nodeEntry[name] !== 'function')
    expect(missing).toEqual([])
  })

  it('exports exportArchive', async () => {
    const nodeEntry = (await import('@/node/index')) as Record<string, unknown>
    expect(typeof nodeEntry.exportArchive).toBe('function')
  })
})
