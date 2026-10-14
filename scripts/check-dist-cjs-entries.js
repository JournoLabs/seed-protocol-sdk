#!/usr/bin/env node
/**
 * Post-build safeguard: every "require" entry in packages/sdk/package.json
 * exports must load under CommonJS and expose the same names as its "import"
 * twin. Its types are shared with the ESM entry, so a missing name is a lie in
 * the published typings.
 *
 * Catches the two ways the CJS build has broken before:
 * - entry built from a different source file than the types describe
 * - chunks emitted as .js in a "type": "module" package, so Node loads them as
 *   ESM and every require()d export is undefined
 *
 * Needs Node >= 20.19 / 22.12 (require of the ESM-only workspace packages).
 * The ESM side loads with the node-eas-lodash hook, as Node ESM users must.
 * Exits 0 if all entries match; exits 1 and prints each problem otherwise.
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const sdkDir = path.join(__dirname, '..', 'packages', 'sdk')
const pkg = JSON.parse(readFileSync(path.join(sdkDir, 'package.json'), 'utf8'))
const require = createRequire(path.join(sdkDir, 'package.json'))
await import(pathToFileURL(path.join(sdkDir, 'src/node/easLodashRegister.js')).href)

let hadViolation = false
const fail = (msg) => {
  console.error(`[check-dist-cjs-entries] ${msg}`)
  hadViolation = true
}

for (const [subpath, conditions] of Object.entries(pkg.exports)) {
  const cjsTarget = conditions?.require?.default
  if (!cjsTarget) continue

  let cjs
  try {
    cjs = require(path.join(sdkDir, cjsTarget))
  } catch (error) {
    fail(`${subpath}: require('${cjsTarget}') threw: ${error.message.split('\n')[0]}`)
    continue
  }

  const cjsNames = Object.keys(cjs).filter((name) => name !== 'default' && name !== '__esModule')
  const undefinedNames = cjsNames.filter((name) => cjs[name] === undefined)
  if (undefinedNames.length > 0) {
    fail(`${subpath}: ${cjsTarget} exports undefined values: ${undefinedNames.join(', ')}`)
  }

  const esmTarget = conditions?.import?.default
  if (!esmTarget) continue
  const esm = await import(pathToFileURL(path.join(sdkDir, esmTarget)).href)
  const esmNames = new Set(Object.keys(esm).filter((name) => name !== 'default'))
  const cjsNameSet = new Set(cjsNames)
  const missing = [...esmNames].filter((name) => !cjsNameSet.has(name))
  const extra = cjsNames.filter((name) => !esmNames.has(name))
  if (missing.length > 0) fail(`${subpath}: ${cjsTarget} is missing ESM exports: ${missing.join(', ')}`)
  if (extra.length > 0) fail(`${subpath}: ${cjsTarget} has exports ESM lacks: ${extra.join(', ')}`)
}

if (hadViolation) {
  process.exit(1)
}
console.log('[check-dist-cjs-entries] CJS entries match their ESM twins')
process.exit(0)
