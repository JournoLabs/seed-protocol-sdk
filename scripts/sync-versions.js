#!/usr/bin/env node
/**
 * Version synchronization script for monorepo packages
 * Ensures SDK and CLI packages have matching versions
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

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
 * Syncs versions across all packages
 * @param {string} newVersion - Optional version to set. If not provided, uses SDK version as source of truth
 */
function syncVersions(newVersion = null) {
  const sdkPackagePath = join(rootDir, 'package.json')
  const cliPackagePath = join(rootDir, 'packages', 'cli', 'package.json')

  const sdkPackage = readPackageJson(sdkPackagePath)
  const cliPackage = readPackageJson(cliPackagePath)

  // Use SDK version as source of truth, or use provided version
  const targetVersion = newVersion || sdkPackage.version

  if (!targetVersion) {
    throw new Error('No version found in SDK package.json')
  }

  console.log(`[Version Sync] Syncing all packages to version: ${targetVersion}`)

  // Update SDK version if newVersion was provided
  if (newVersion && sdkPackage.version !== newVersion) {
    sdkPackage.version = newVersion
    writePackageJson(sdkPackagePath, sdkPackage)
    console.log(`[Version Sync] Updated SDK version to ${newVersion}`)
  }

  // Update CLI version
  if (cliPackage.version !== targetVersion) {
    cliPackage.version = targetVersion
    writePackageJson(cliPackagePath, cliPackage)
    console.log(`[Version Sync] Updated CLI version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] CLI version already at ${targetVersion}`)
  }

  // Update CLI's SDK dependency version to match
  if (cliPackage.dependencies && cliPackage.dependencies['@seedprotocol/sdk']) {
    // For local development, keep file: protocol
    // For published packages, this will be updated in prepublishOnly
    console.log(`[Version Sync] CLI SDK dependency: ${cliPackage.dependencies['@seedprotocol/sdk']}`)
  }

  console.log('[Version Sync] Version synchronization complete!')
  console.log(`[Version Sync] SDK: ${sdkPackage.version}`)
  console.log(`[Version Sync] CLI: ${cliPackage.version}`)
}

// Run if called directly (simplified - always execute when run as script)
// This script is meant to be run directly, not imported
const newVersion = process.argv[2] || null
try {
  syncVersions(newVersion)
  process.exit(0)
} catch (error) {
  console.error('[Version Sync] Error:', error.message)
  process.exit(1)
}

export { syncVersions }

