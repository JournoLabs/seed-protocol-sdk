#!/usr/bin/env node
/**
 * Fails when the package.json in the current directory still has a `workspace:` specifier.
 *
 * npm packs package.json as it is on disk and doesn't rewrite `workspace:` ranges, so a manifest
 * that keeps one publishes a package that `npm install` refuses (EUNSUPPORTEDPROTOCOL).
 * `scripts/publish-package.js` rewrites them before `npm publish`; a plain `npm publish` in a
 * package directory doesn't. Every public package runs this last in its `prepublishOnly`, so both
 * routes stop here.
 */

import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/**
 * @param {Record<string, unknown>} manifest
 * @returns {string[]} `field.name: spec` for each `workspace:` specifier
 */
export function workspaceSpecifiers(manifest) {
  const found = []
  for (const field of DEP_FIELDS) {
    const block = manifest[field]
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    for (const [name, spec] of Object.entries(block)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) found.push(`${field}.${name}: ${spec}`)
    }
  }
  return found
}

const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const manifestPath = join(process.cwd(), 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const found = workspaceSpecifiers(manifest)
  if (found.length > 0) {
    console.error(`${manifest.name}: package.json still has workspace: specifiers, which npm can't install:`)
    for (const line of found) console.error(`  ${line}`)
    console.error('Publish with `node scripts/publish-package.js <name>` from the repo root, which pins them.')
    process.exit(1)
  }
}
