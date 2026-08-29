#!/usr/bin/env node
/**
 * Bump or set the monorepo package version, then sync all packages.
 *
 * Usage:
 *   node scripts/new-version.js           # bump patch (0.5.0 -> 0.5.1)
 *   node scripts/new-version.js 0.6.0     # set explicit version
 *   bun run new-version
 *   bun run new-version -- 0.6.0
 *
 * Does not commit, tag, or publish.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { syncVersions } from './sync-versions.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

/** Semver with optional pre-release / build metadata */
const SEMVER_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * @param {string} version
 * @returns {boolean}
 */
function isValidSemver(version) {
  return SEMVER_RE.test(version)
}

/**
 * Bump the patch segment of a plain x.y.z version.
 * Pre-release / build metadata is not supported for auto-bump — pass an explicit version.
 * @param {string} version
 * @returns {string}
 */
function bumpPatch(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) {
    throw new Error(
      `Cannot auto-bump patch for "${version}". Pass an explicit semver (e.g. 0.5.1).`,
    )
  }
  const major = match[1]
  const minor = match[2]
  const patch = Number(match[3]) + 1
  return `${major}.${minor}.${patch}`
}

function getSdkVersion() {
  const sdkPackagePath = join(rootDir, 'packages', 'sdk', 'package.json')
  const sdkPackage = JSON.parse(readFileSync(sdkPackagePath, 'utf-8'))
  if (!sdkPackage.version) {
    throw new Error('No version found in packages/sdk/package.json')
  }
  return sdkPackage.version
}

function main() {
  const arg = process.argv[2] || null
  const currentVersion = getSdkVersion()

  let targetVersion
  let mode

  if (arg) {
    if (!isValidSemver(arg)) {
      console.error(`[new-version] Invalid version: ${arg}`)
      console.error('Usage: bun run new-version              # bump patch')
      console.error('       bun run new-version -- <semver>  # set version')
      process.exit(1)
    }
    targetVersion = arg
    mode = 'set'
  } else {
    targetVersion = bumpPatch(currentVersion)
    mode = 'patch'
  }

  if (targetVersion === currentVersion) {
    console.log(`[new-version] Already at ${currentVersion}; syncing packages.`)
  } else if (mode === 'patch') {
    console.log(`[new-version] Bumping patch: ${currentVersion} → ${targetVersion}`)
  } else {
    console.log(`[new-version] Setting version: ${currentVersion} → ${targetVersion}`)
  }

  syncVersions(targetVersion)

  console.log(`[new-version] Done. All packages are at ${targetVersion}.`)
  console.log('[new-version] No commit, tag, or publish was performed.')
}

try {
  main()
  process.exit(0)
} catch (error) {
  console.error('[new-version] Error:', error.message)
  process.exit(1)
}
