#!/usr/bin/env node
/**
 * Version synchronization script for monorepo packages
 * Ensures SDK, CLI, Publish, Feed, Feed-hyper, and Ghost packages have matching versions
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
  const feedHyperPackagePath = join(rootDir, 'packages', 'feed-hyper', 'package.json')
  const gatewayHyperPackagePath = join(rootDir, 'packages', 'gateway-hyper', 'package.json')
  const easPackagePath = join(rootDir, 'packages', 'eas', 'package.json')
  const arweavePackagePath = join(rootDir, 'packages', 'arweave', 'package.json')
  const ghostPackagePath = join(rootDir, 'packages', 'ghost', 'package.json')

  const sdkPackage = readPackageJson(sdkPackagePath)
  const reactPackage = readPackageJson(reactPackagePath)
  const cliPackage = readPackageJson(cliPackagePath)
  const publishPackage = readPackageJson(publishPackagePath)
  const feedPackage = readPackageJson(feedPackagePath)
  const feedHyperPackage = readPackageJson(feedHyperPackagePath)
  const gatewayHyperPackage = readPackageJson(gatewayHyperPackagePath)
  const easPackage = readPackageJson(easPackagePath)
  const arweavePackage = readPackageJson(arweavePackagePath)
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

  // Update Feed-hyper version
  if (feedHyperPackage.version !== targetVersion) {
    feedHyperPackage.version = targetVersion
    writePackageJson(feedHyperPackagePath, feedHyperPackage)
    console.log(`[Version Sync] Updated Feed-hyper version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] Feed-hyper version already at ${targetVersion}`)
  }

  // Update Gateway-hyper version
  if (gatewayHyperPackage.version !== targetVersion) {
    gatewayHyperPackage.version = targetVersion
    writePackageJson(gatewayHyperPackagePath, gatewayHyperPackage)
    console.log(`[Version Sync] Updated Gateway-hyper version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] Gateway-hyper version already at ${targetVersion}`)
  }

  // Update EAS version
  if (easPackage.version !== targetVersion) {
    easPackage.version = targetVersion
    writePackageJson(easPackagePath, easPackage)
    console.log(`[Version Sync] Updated EAS version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] EAS version already at ${targetVersion}`)
  }

  // Update Arweave version
  if (arweavePackage.version !== targetVersion) {
    arweavePackage.version = targetVersion
    writePackageJson(arweavePackagePath, arweavePackage)
    console.log(`[Version Sync] Updated Arweave version to ${targetVersion}`)
  } else {
    console.log(`[Version Sync] Arweave version already at ${targetVersion}`)
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
  console.log(`[Version Sync] Feed-hyper: ${feedHyperPackage.version}`)
  console.log(`[Version Sync] Gateway-hyper: ${gatewayHyperPackage.version}`)
  console.log(`[Version Sync] EAS: ${easPackage.version}`)
  console.log(`[Version Sync] Arweave: ${arweavePackage.version}`)
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

