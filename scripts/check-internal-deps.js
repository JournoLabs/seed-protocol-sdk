#!/usr/bin/env node
/**
 * Fail if any package.json refers to an @seedprotocol/* package by anything but `workspace:`.
 *
 * Every package is released at the same version, and workspace-publish-manifest.js turns
 * `workspace:` refs into that exact version at publish. A hand-written range (a stale
 * `^0.6.0`, say) would skip that and let one version run against another.
 *
 * Checks committed manifests only: during `npm publish` the refs are exact versions on purpose.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

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
  console.log('[internal-deps] OK — every @seedprotocol/* ref uses workspace:')
}
