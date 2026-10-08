import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guards for the repo's drizzle tooling: `bun run drizzle:update` (scripts/update-drizzle.ts) is the
 * one way to generate SDK migrations and drizzleFiles.ts. NodeJS project only.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf-8')

const filesUnder = (dir: string): string[] => {
  const abs = path.join(repoRoot, dir)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    )
}

describe('drizzle tooling', () => {
  it('only the shared renderer writes drizzleFiles.ts', () => {
    // A second generator drifts from packages/sdk/scripts/drizzleFiles.ts, which
    // drizzleMigrations.test.ts holds the committed file to.
    const writers = filesUnder('scripts')
      .filter((file) => /\.(ts|js|mjs|sh)$/.test(file))
      .filter((file) => read(file).includes('drizzleFiles.ts'))
      .filter((file) => !read(file).includes('packages/sdk/scripts/drizzleFiles'))
    expect(writers).toEqual([])
  })

  it('root package.json scripts only run script files that exist', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    const missing = Object.entries(scripts).flatMap(([name, command]) =>
      [...command.matchAll(/(?:^|\s)((?:\.\/)?scripts\/[\w./-]+\.(?:ts|js|mjs|cjs|sh))/g)]
        .map((m) => m[1]!)
        .filter((file) => !fs.existsSync(path.join(repoRoot, file)))
        .map((file) => `${name}: ${file}`),
    )
    expect(missing).toEqual([])
  })
})
