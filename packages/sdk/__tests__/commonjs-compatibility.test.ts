/**
 * Checks that package.json's entry points (main/module/exports) point at files the rollup build actually
 * emits, in the right module format: `require` conditions must hit a CommonJS output, `import`
 * conditions an ESM one. This caught exports drifting from `./dist/main.cjs.js` to `./dist/main.cjs`.
 *
 * Runs without building: rollup.config.mjs is imported with its plugins stubbed out, so only the
 * declared inputs/outputs are read.
 */

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const stubPlugin = (name: string) => ({ default: () => ({ name }) })
vi.mock('@rollup/plugin-typescript', () => stubPlugin('typescript'))
vi.mock('rollup-plugin-copy', () => stubPlugin('copy'))
vi.mock('rollup-plugin-tsconfig-paths', () => stubPlugin('tsconfig-paths'))
vi.mock('@rollup/plugin-commonjs', () => stubPlugin('commonjs'))
vi.mock('@rollup/plugin-alias', () => stubPlugin('alias'))
vi.mock('@rollup/plugin-json', () => stubPlugin('json'))

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

type RollupOptions = {
  input: Record<string, string>
  output: { dir: string; format: string; entryFileNames: string }[]
}

/** Map of emitted entry file (e.g. `./dist/main.cjs`) to its format and source module. */
async function emittedEntries() {
  const { default: configs } = (await import('../rollup.config.mjs')) as { default: RollupOptions[] }
  const entries = new Map<string, { format: string; source: string }>()
  for (const config of configs) {
    for (const output of config.output) {
      for (const [name, source] of Object.entries(config.input)) {
        const file = output.entryFileNames.replace('[name]', name)
        entries.set(`./${path.posix.join(output.dir, file)}`, { format: output.format, source })
      }
    }
  }
  return entries
}

/** Every (condition path, target) pair under an exports entry, skipping `types`. */
function exportTargets(value: unknown, conditions: string[] = []): [string[], string][] {
  if (typeof value === 'string') return [[conditions, value]]
  return Object.entries(value as Record<string, unknown>)
    .filter(([condition]) => condition !== 'types')
    .flatMap(([condition, next]) => exportTargets(next, [...conditions, condition]))
}

describe('CommonJS compatibility of package entry points', () => {
  it('main points at the CommonJS node build and module at the ESM main build', async () => {
    const entries = await emittedEntries()
    expect(entries.get(packageJson.main)).toEqual({ format: 'cjs', source: 'src/node/index.ts' })
    expect(entries.get(packageJson.module)).toEqual({ format: 'esm', source: 'src/index.ts' })
  })

  it('"." resolves to CJS for require and ESM for import', () => {
    const root = packageJson.exports['.']
    expect(root.require.default).toBe(packageJson.main)
    expect(root.import.default).toBe(packageJson.module)
  })

  it('every dist export target is emitted by rollup in the format its condition expects', async () => {
    const entries = await emittedEntries()
    const problems: string[] = []

    for (const [subpath, value] of Object.entries(packageJson.exports)) {
      for (const [conditions, target] of exportTargets(value)) {
        if (!target.startsWith('./dist/')) continue
        const label = `${subpath} [${conditions.join('.')}] -> ${target}`
        const entry = entries.get(target)
        if (!entry) {
          problems.push(`${label}: not emitted by rollup.config.mjs`)
        } else if (conditions.includes('require') && entry.format !== 'cjs') {
          problems.push(`${label}: require condition points at ${entry.format} output`)
        } else if (conditions.includes('import') && entry.format !== 'esm') {
          problems.push(`${label}: import condition points at ${entry.format} output`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('non-dist export targets exist in the package', () => {
    for (const [, value] of Object.entries(packageJson.exports)) {
      for (const [, target] of exportTargets(value)) {
        if (target.startsWith('./dist/')) continue
        expect(fs.existsSync(path.join(packageRoot, target)), target).toBe(true)
      }
    }
  })
})
