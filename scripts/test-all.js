#!/usr/bin/env node
/**
 * The full test run behind `bun run test` (what CI runs): root vitest, each package's own
 * `test` script, then the repo checks. Steps run in order and stop at the first failure.
 *
 * check-tests-wired.js imports PACKAGE_TESTS to confirm every package with a `test` script
 * is run here or by the root vite.config.js.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Packages whose own `test` script runs here, in this order. */
export const PACKAGE_TESTS = [
  '@seedprotocol/bundler-core',
  '@seedprotocol/archive',
  '@seedprotocol/vite',
  '@seedprotocol/query',
  '@seedprotocol/eas',
  '@seedprotocol/arweave',
  '@seedprotocol/feed-hyper',
  '@seedprotocol/gateway-hyper',
  '@seedprotocol/next',
  '@seedprotocol/publish',
]

const STEPS = [
  'node scripts/check-node-env.js',
  'tsc -p packages/sdk/tsconfig.typetests.json',
  'vitest run --reporter=default',
  ...PACKAGE_TESTS.map((name) => `bun run --filter ${name} test`),
  'node scripts/check-tests-wired.js',
  'node scripts/check-tier1-package-boundary.js',
  'node scripts/check-internal-deps.js',
  'node scripts/check-browser-entry-graph.js --fail',
  'node scripts/check-eas-sdk-node-import.js',
  'bun run test:scripts',
]

function run(command) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, { stdio: 'inherit', shell: true, cwd: rootDir })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`\`${command}\` failed with exit code ${code}`))
    })
    proc.on('error', reject)
  })
}

async function main() {
  for (const step of STEPS) {
    console.log(`\n▶ ${step}\n`)
    await run(step)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n❌ ${error.message}`)
    process.exit(1)
  })
}
