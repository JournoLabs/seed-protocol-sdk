#!/usr/bin/env node
/**
 * Fails if tests exist that `bun run test` (what CI runs) never runs.
 *
 * - Every workspace package with a `test` script must be run by the root
 *   `test` script (`bun run --filter <name> test`), unless the root
 *   vite.config.js already includes its __tests__ or the script runs that
 *   config. arweave, feed-hyper, gateway-hyper, publish and webpack went
 *   unrun this way.
 * - publish tests use two runners: bun:test files are listed one by one in
 *   the package's `test` script (separate `bun test` runs, because bun's
 *   mock.module leaks across files in one run), and a few vitest files are
 *   listed in the root vite.config.js. A new file in neither list is silently
 *   never run, which is how savePublish.test.ts went unrun.
 *
 * Exits 0 if everything is wired; exits 1 and prints each gap otherwise.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')
const publishDir = path.join(rootDir, 'packages', 'publish')

function* walkTestFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      yield* walkTestFiles(full)
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      yield full
    }
  }
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const bunScript = readJson(path.join(publishDir, 'package.json')).scripts.test
const bunListed = new Set(bunScript.match(/\S+\.test\.tsx?/g) ?? [])
const viteConfig = readFileSync(path.join(rootDir, 'vite.config.js'), 'utf8')
const rootTest = readJson(path.join(rootDir, 'package.json')).scripts.test

let hadViolation = false

const packagesDir = path.join(rootDir, 'packages')
for (const dir of readdirSync(packagesDir)) {
  let pkg
  try {
    pkg = readJson(path.join(packagesDir, dir, 'package.json'))
  } catch {
    continue
  }
  const script = pkg.scripts?.test
  if (!script) continue
  const runByRoot = rootTest.includes(`--filter ${pkg.name} test`)
  const inRootVitest = viteConfig.includes(`'packages/${dir}/__tests__/`)
  const runsRootVitest = script.includes('--config vite.config.js')
  if (!runByRoot && !inRootVitest && !runsRootVitest) {
    console.error(`[check-tests-wired] ${pkg.name} has a test script that the root "test" script never runs`)
    hadViolation = true
  }
}

for (const file of walkTestFiles(path.join(publishDir, 'src'))) {
  const fromPublish = path.relative(publishDir, file).split(path.sep).join('/')
  const fromRoot = path.relative(rootDir, file).split(path.sep).join('/')
  const source = readFileSync(file, 'utf8')
  if (/from ['"]bun:test['"]/.test(source)) {
    if (!bunListed.has(fromPublish)) {
      console.error(`[check-tests-wired] ${fromRoot} uses bun:test but is not in packages/publish "test"`)
      hadViolation = true
    }
  } else if (!viteConfig.includes(`'${fromRoot}'`)) {
    console.error(`[check-tests-wired] ${fromRoot} is not bun:test and not listed in vite.config.js`)
    hadViolation = true
  }
}

if (hadViolation) {
  process.exit(1)
}
process.exit(0)
