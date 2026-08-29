#!/usr/bin/env node
/**
 * Version synchronization script for monorepo packages
 * Ensures supported packages have matching versions (excludes experimental private packages).
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

/**
 * Supported packages synced to the SDK version. Experimental packages
 * (cli, webpack, ghost) are private and intentionally excluded.
 */
const SYNC_PACKAGES = [
  'sdk',
  'react',
  'publish',
  'feed',
  'feed-hyper',
  'gateway-hyper',
  'eas',
  'arweave',
  'vite',
]

/**
 * Reads and parses a package.json file
 */
function readPackageJson(path) {
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content)
}

/**
 * Writes a package.json file with proper formatting
 */
function writePackageJson(path, data) {
  const content = JSON.stringify(data, null, 2) + '\n'
  writeFileSync(path, content, 'utf-8')
}

/**
 * Syncs versions across all supported packages
 * @param {string} newVersion - Optional version to set. If not provided, uses SDK version as source of truth
 */
function syncVersions(newVersion = null) {
  const packages = Object.fromEntries(
    SYNC_PACKAGES.map((name) => {
      const packagePath = join(rootDir, 'packages', name, 'package.json')
      return [name, { path: packagePath, pkg: readPackageJson(packagePath) }]
    }),
  )

  const targetVersion = newVersion || packages.sdk.pkg.version

  if (!targetVersion) {
    throw new Error('No version found in SDK package.json')
  }

  console.log(`[Version Sync] Syncing all packages to version: ${targetVersion}`)

  // Keep monorepo root version aligned (private; not published)
  const rootPackagePath = join(rootDir, 'package.json')
  const rootPackage = readPackageJson(rootPackagePath)
  if (rootPackage.version !== targetVersion) {
    rootPackage.version = targetVersion
    writePackageJson(rootPackagePath, rootPackage)
    console.log(`[Version Sync] Updated root version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] Root version already at ${targetVersion}`)
  }

  for (const name of SYNC_PACKAGES) {
    const { path: packagePath, pkg } = packages[name]
    if (pkg.version !== targetVersion) {
      pkg.version = targetVersion
      writePackageJson(packagePath, pkg)
      console.log(`[Version Sync] Updated ${name} version to ${targetVersion}`)
    } else {
      console.log(`[Version Sync] ${name} version already at ${targetVersion}`)
    }

    if (pkg.dependencies && pkg.dependencies['@seedprotocol/sdk']) {
      console.log(
        `[Version Sync] ${name} SDK dependency: ${pkg.dependencies['@seedprotocol/sdk']}`,
      )
    }
  }

  console.log('[Version Sync] Version synchronization complete!')
  console.log(`[Version Sync] Root: ${rootPackage.version}`)
  for (const name of SYNC_PACKAGES) {
    console.log(`[Version Sync] ${name}: ${packages[name].pkg.version}`)
  }
}

export { syncVersions }

// Only run when invoked as a CLI script (not when imported by new-version.js)
const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const newVersion = process.argv[2] || null
  try {
    syncVersions(newVersion)
    process.exit(0)
  } catch (error) {
    console.error('[Version Sync] Error:', error.message)
    process.exit(1)
  }
}
