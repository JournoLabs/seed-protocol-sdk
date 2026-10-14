/**
 * Checks that package.json's entry points (main/module/exports) point at files the rollup build actually
 * emits. The SDK ships no CommonJS build of its own entries: `require` conditions point at the same ESM
 * file as their `import` twin, which Node 20.19+ / 22.12+ loads via require(esm). A `require` condition
 * may also point at a CommonJS output (vite.cjs), whose chunks then need the .cjs extension.
 * scripts/check-dist-cjs-entries.js checks the built files really load under require().
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
  output: { dir: string; format: string; entryFileNames: string; chunkFileNames?: string }[]
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
  it('main and module are the ESM build of src/index.ts', async () => {
    const entries = await emittedEntries()
    expect(entries.get(packageJson.main)).toEqual({ format: 'esm', source: 'src/index.ts' })
    expect(entries.get(packageJson.module)).toEqual({ format: 'esm', source: 'src/index.ts' })
  })

  it('every require entry is built from the same source as its import twin', async () => {
    const entries = await emittedEntries()
    const problems: string[] = []
    for (const [subpath, value] of Object.entries(packageJson.exports)) {
      const conditions = value as { require?: { default?: string }; import?: { default?: string } }
      const cjs = conditions.require?.default
      const esm = conditions.import?.default
      if (!cjs || !esm) continue
      const cjsSource = entries.get(cjs)?.source
      const esmSource = entries.get(esm)?.source
      if (cjsSource !== esmSource) problems.push(`${subpath}: require builds ${cjsSource}, import builds ${esmSource}`)
    }
    expect(problems).toEqual([])
  })

  it('CommonJS chunks use the .cjs extension so Node does not load them as ESM', async () => {
    const { default: configs } = (await import('../rollup.config.mjs')) as { default: RollupOptions[] }
    const cjsOutputs = configs.flatMap((config) => config.output).filter((output) => output.format === 'cjs')
    expect(cjsOutputs.length).toBeGreaterThan(0)
    for (const output of cjsOutputs) {
      expect(output.chunkFileNames).toMatch(/\.cjs$/)
    }
  })

  it('"." and "./node" resolve to the same ESM file for require and import', () => {
    for (const subpath of ['.', './node']) {
      const entry = packageJson.exports[subpath]
      expect(entry.require.default, subpath).toBe(entry.import.default)
    }
    expect(packageJson.exports['.'].require.default).toBe(packageJson.main)
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
