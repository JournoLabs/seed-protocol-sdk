#!/usr/bin/env node
/**
 * Fail if any package.json refers to an @seedprotocol/* package by anything but `workspace:`, or if
 * a package CI publishes needs, at install time, an internal package CI doesn't publish before it.
 *
 * Every package is released at the same version, and workspace-publish-manifest.js turns
 * `workspace:` refs into that exact version at publish. A hand-written range (a stale
 * `^0.6.0`, say) would skip that and let one version run against another.
 *
 * The second check stops a repeat of 0.7.10, where the SDK depended on `@seedprotocol/archive`
 * while archive sat in AWAITING_FIRST_PUBLISH, so `npm install @seedprotocol/sdk@0.7.10` failed
 * with E404.
 *
 * Checks committed manifests only: during `npm publish` the refs are exact versions on purpose.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AWAITING_FIRST_PUBLISH, PUBLISH_ORDER } from './release-channel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/** Fields npm installs (or asks the app to install) for a consumer. devDependencies aren't. */
const INSTALL_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

/**
 * @param {Record<string, unknown>} manifest
 * @returns {string[]} `field.name = value` for each internal ref that isn't workspace:
 */
export function nonWorkspaceInternalRefs(manifest) {
  const problems = []
  for (const field of DEP_FIELDS) {
    const block = manifest[field]
    if (!block || typeof block !== 'object') continue
    for (const [name, value] of Object.entries(block)) {
      if (!name.startsWith('@seedprotocol/')) continue
      if (typeof value === 'string' && value.startsWith('workspace:')) continue
      problems.push(`${field}.${name} = ${JSON.stringify(value)}`)
    }
  }
  return problems
}

/**
 * @param {Record<string, Record<string, unknown>>} manifests package.json by package folder name
 * @param {{ publishOrder: string[], awaitingFirstPublish: string[] }} lists from release-channel.js
 * @returns {string[]} one line per install-time internal ref a release would publish broken
 */
export function unpublishedInstallRefs(manifests, { publishOrder, awaitingFirstPublish }) {
  const folderByName = new Map(
    Object.entries(manifests).map(([folder, manifest]) => [manifest.name, folder]),
  )
  const problems = []
  for (const [index, folder] of publishOrder.entries()) {
    const manifest = manifests[folder]
    if (!manifest) continue
    for (const field of INSTALL_FIELDS) {
      const block = manifest[field]
      if (!block || typeof block !== 'object') continue
      for (const name of Object.keys(block)) {
        if (!name.startsWith('@seedprotocol/')) continue
        const target = folderByName.get(name) ?? name.slice('@seedprotocol/'.length)
        const at = publishOrder.indexOf(target)
        if (at === -1) {
          const why = awaitingFirstPublish.includes(target)
            ? 'is in AWAITING_FIRST_PUBLISH: publish it by hand, then move it into PUBLISH_ORDER'
            : 'is not in PUBLISH_ORDER'
          problems.push(`${folder} ${field}.${name}: ${target} ${why}`)
        } else if (at > index) {
          problems.push(`${folder} ${field}.${name}: ${target} comes after ${folder} in PUBLISH_ORDER`)
        }
      }
    }
  }
  return problems
}

function manifestPaths() {
  const packagesDir = join(rootDir, 'packages')
  const paths = [join(rootDir, 'package.json')]
  for (const name of readdirSync(packagesDir)) {
    const path = join(packagesDir, name, 'package.json')
    if (existsSync(path)) paths.push(path)
  }
  return paths
}

const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const all = manifestPaths().flatMap((path) => {
    const manifest = JSON.parse(readFileSync(path, 'utf-8'))
    return nonWorkspaceInternalRefs(manifest).map((p) => `${relative(rootDir, path)}: ${p}`)
  })
  if (all.length > 0) {
    console.error('[internal-deps] @seedprotocol/* refs must use workspace:*')
    for (const v of all) console.error(`  - ${v}`)
    process.exit(1)
  }
  const packagesDir = join(rootDir, 'packages')
  const manifests = Object.fromEntries(
    manifestPaths()
      .filter((path) => dirname(dirname(path)) === packagesDir)
      .map((path) => [relative(packagesDir, dirname(path)), JSON.parse(readFileSync(path, 'utf-8'))]),
  )
  const unpublished = unpublishedInstallRefs(manifests, {
    publishOrder: PUBLISH_ORDER,
    awaitingFirstPublish: AWAITING_FIRST_PUBLISH,
  })
  if (unpublished.length > 0) {
    console.error('[internal-deps] a published package would need an internal package CI does not publish before it')
    for (const v of unpublished) console.error(`  - ${v}`)
    process.exit(1)
  }
  console.log('[internal-deps] OK — every @seedprotocol/* ref uses workspace:, and published packages need only packages published before them')
}
