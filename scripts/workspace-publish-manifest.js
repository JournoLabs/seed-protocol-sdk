#!/usr/bin/env node
/**
 * Replace @seedprotocol/* workspace: protocol refs with exact versions for npm publish,
 * then restore the original package.json from backup. Keeps committed manifests on workspace:*.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/**
 * @param {string} value
 */
function isWorkspaceProtocol(value) {
  return typeof value === 'string' && value.startsWith('workspace:')
}

/**
 * @param {string} rootDir - monorepo root
 * @param {string} scopedName - e.g. @seedprotocol/sdk
 */
function getPublishedVersionForPackage(rootDir, scopedName) {
  if (!scopedName.startsWith('@seedprotocol/')) {
    throw new Error(`Expected @seedprotocol/* package name, got: ${scopedName}`)
  }
  const shortName = scopedName.slice('@seedprotocol/'.length)
  const manifestPath = join(rootDir, 'packages', shortName, 'package.json')
  const raw = readFileSync(manifestPath, 'utf-8')
  const pkg = JSON.parse(raw)
  if (!pkg.version) {
    throw new Error(`No version in ${manifestPath}`)
  }
  return pkg.version
}

/**
 * Mutates manifest object in place: workspace:* -> exact semver for internal packages.
 * @param {Record<string, unknown>} manifest
 * @param {string} rootDir
 */
function applyWorkspaceReplacements(manifest, rootDir) {
  for (const field of DEP_FIELDS) {
    const block = manifest[field]
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    for (const name of Object.keys(block)) {
      if (!name.startsWith('@seedprotocol/')) continue
      const value = block[name]
      if (!isWorkspaceProtocol(value)) continue
      block[name] = getPublishedVersionForPackage(rootDir, name)
    }
  }
}

/**
 * Write package.json with stable formatting (matches sync-versions.js).
 * @param {string} manifestPath
 * @param {Record<string, unknown>} data
 */
function writePackageJson(manifestPath, data) {
  const content = JSON.stringify(data, null, 2) + '\n'
  writeFileSync(manifestPath, content, 'utf-8')
}

/**
 * @param {string} rootDir - monorepo root (directory containing packages/)
 * @param {string} packageDir - relative path e.g. packages/cli
 * @returns {{ manifestPath: string, backup: string }}
 */
export function preparePublishManifest(rootDir, packageDir) {
  const manifestPath = join(rootDir, packageDir, 'package.json')
  const backup = readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(backup)
  applyWorkspaceReplacements(manifest, rootDir)
  writePackageJson(manifestPath, manifest)
  return { manifestPath, backup }
}

/**
 * @param {string} manifestPath
 * @param {string} backup
 */
export function restorePublishManifest(manifestPath, backup) {
  writeFileSync(manifestPath, backup, 'utf-8')
}

/**
 * Runs asyncFn after applying publishable deps; always restores original package.json.
 * @param {string} rootDir
 * @param {string} packageDir - relative e.g. packages/react
 * @param {() => Promise<void>} asyncFn
 */
export async function withPublishableWorkspaceManifest(rootDir, packageDir, asyncFn) {
  const { manifestPath, backup } = preparePublishManifest(rootDir, packageDir)
  try {
    await asyncFn()
  } finally {
    restorePublishManifest(manifestPath, backup)
  }
}

/**
 * Default root when run as CLI from repo root.
 */
export function getDefaultRootDir() {
  return join(__dirname, '..')
}
