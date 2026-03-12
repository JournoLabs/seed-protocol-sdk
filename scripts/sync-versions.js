#!/usr/bin/env node
/**
 * Version synchronization script for monorepo packages
 * Ensures SDK, CLI, Publish, Feed, and Ghost packages have matching versions
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
  const sdkPackagePath = join(rootDir, 'packages', 'sdk', 'package.json')
  const reactPackagePath = join(rootDir, 'packages', 'react', 'package.json')
  const cliPackagePath = join(rootDir, 'packages', 'cli', 'package.json')
  const publishPackagePath = join(rootDir, 'packages', 'publish', 'package.json')
  const feedPackagePath = join(rootDir, 'packages', 'feed', 'package.json')
  const ghostPackagePath = join(rootDir, 'packages', 'ghost', 'package.json')

  const sdkPackage = readPackageJson(sdkPackagePath)
  const reactPackage = readPackageJson(reactPackagePath)
  const cliPackage = readPackageJson(cliPackagePath)
  const publishPackage = readPackageJson(publishPackagePath)
  const feedPackage = readPackageJson(feedPackagePath)
  const ghostPackage = readPackageJson(ghostPackagePath)

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

  // Update React version
  if (reactPackage.version !== targetVersion) {
    reactPackage.version = targetVersion
    writePackageJson(reactPackagePath, reactPackage)
    console.log(`[Version Sync] Updated React version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] React version already at ${targetVersion}`)
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

  // Update Publish version
  if (publishPackage.version !== targetVersion) {
    publishPackage.version = targetVersion
    writePackageJson(publishPackagePath, publishPackage)
    console.log(`[Version Sync] Updated Publish version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] Publish version already at ${targetVersion}`)
  }

  // Update Publish's SDK dependency version to match
  if (publishPackage.dependencies && publishPackage.dependencies['@seedprotocol/sdk']) {
    console.log(`[Version Sync] Publish SDK dependency: ${publishPackage.dependencies['@seedprotocol/sdk']}`)
  }

  // Update Feed version
  if (feedPackage.version !== targetVersion) {
    feedPackage.version = targetVersion
    writePackageJson(feedPackagePath, feedPackage)
    console.log(`[Version Sync] Updated Feed version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] Feed version already at ${targetVersion}`)
  }

  // Update Feed's SDK dependency version to match
  if (feedPackage.dependencies && feedPackage.dependencies['@seedprotocol/sdk']) {
    console.log(`[Version Sync] Feed SDK dependency: ${feedPackage.dependencies['@seedprotocol/sdk']}`)
  }

  // Update Ghost version
  if (ghostPackage.version !== targetVersion) {
    ghostPackage.version = targetVersion
    writePackageJson(ghostPackagePath, ghostPackage)
    console.log(`[Version Sync] Updated Ghost version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] Ghost version already at ${targetVersion}`)
  }

  // Update Ghost's SDK dependency version to match
  if (ghostPackage.dependencies && ghostPackage.dependencies['@seedprotocol/sdk']) {
    console.log(`[Version Sync] Ghost SDK dependency: ${ghostPackage.dependencies['@seedprotocol/sdk']}`)
  }

  console.log('[Version Sync] Version synchronization complete!')
  console.log(`[Version Sync] SDK: ${sdkPackage.version}`)
  console.log(`[Version Sync] React: ${reactPackage.version}`)
  console.log(`[Version Sync] CLI: ${cliPackage.version}`)
  console.log(`[Version Sync] Publish: ${publishPackage.version}`)
  console.log(`[Version Sync] Feed: ${feedPackage.version}`)
  console.log(`[Version Sync] Ghost: ${ghostPackage.version}`)
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

