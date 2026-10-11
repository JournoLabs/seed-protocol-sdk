#!/usr/bin/env node
/**
 * Fails fast when the Node running the tests can't pass them, instead of letting a wrong Node
 * surface as a dozen unrelated-looking failures:
 * - Node < 24.5 has no `navigator.locks`, so withTabLock runs sections unlocked and the
 *   concurrency tests (tabLocks, addExcludedTransactions, ensureModelStubs) race.
 * - better-sqlite3 is a native addon built for the Node that ran `bun install`; switching Node
 *   afterwards fails database.test.ts with a NODE_MODULE_VERSION mismatch.
 * A major version other than .nvmrc's only warns.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const WEB_LOCKS_MIN = [24, 5]

const FIX = 'Run `nvm use` (reads .nvmrc), then `bun install --force` to rebuild native modules for it.'

export function parseVersion(version) {
  return version.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10))
}

/** Problems that make tests fail, and warnings that don't, for the given runtime. */
export function checkNodeEnv({ version, hasLocks, nvmrc, loadSqlite }) {
  const errors = []
  const warnings = []
  const [major] = parseVersion(version)

  if (!hasLocks) {
    errors.push(
      `Node ${version} has no navigator.locks (added in ${WEB_LOCKS_MIN.join('.')}), so tab locks are no-ops and concurrency tests fail.`,
    )
  }

  const wanted = nvmrc?.trim()
  if (wanted && Number.parseInt(wanted, 10) !== major) {
    warnings.push(`Node ${version} doesn't match .nvmrc (${wanted}); CI runs ${wanted}.`)
  }

  try {
    loadSqlite()
  } catch (error) {
    const abi = /NODE_MODULE_VERSION/.test(error?.message ?? '')
    errors.push(
      abi
        ? `better-sqlite3 was built for a different Node than ${version} (NODE_MODULE_VERSION mismatch).`
        : `better-sqlite3 failed to load: ${error?.message ?? error}`,
    )
  }

  return { errors, warnings }
}

function main() {
  let nvmrc
  try {
    nvmrc = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8')
  } catch {}
  const sdkRequire = createRequire(path.join(root, 'packages/sdk/package.json'))

  const { errors, warnings } = checkNodeEnv({
    version: process.version,
    hasLocks: typeof globalThis.navigator?.locks?.request === 'function',
    nvmrc,
    loadSqlite: () => new (sdkRequire('better-sqlite3'))(':memory:').close(),
  })

  for (const warning of warnings) console.warn(`[node-env] warning: ${warning}`)
  if (errors.length > 0) {
    for (const error of errors) console.error(`[node-env] ${error}`)
    console.error(`[node-env] ${FIX}`)
    process.exit(1)
  }
  console.log(`[node-env] OK — Node ${process.version}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
