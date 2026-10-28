#!/usr/bin/env node
/**
 * Post-build check for packages/eas/dist/node.js: undici's Agent must be loaded with a literal
 * dynamic import, and nothing may go through createRequire.
 *
 * A consumer that bundles @seedprotocol/eas (Astro with `ssr.noExternal`, say) resolves a literal
 * import from eas's own folder, and @vercel/nft traces it into the serverless function.
 * `createRequire(import.meta.url)('undici/...')` did neither: import.meta.url became the app's
 * chunk, so the require resolved from the app, where Bun's isolated installs don't put undici.
 *
 * Also checks the deep path still resolves from packages/eas (undici would break it by adding an
 * exports map).
 * Usage: node scripts/check-dist-eas-node-undici.js
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const easDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'eas')
const distFile = path.join(easDir, 'dist', 'node.js')
const AGENT_MODULE = 'undici/lib/dispatcher/agent.js'

function fail(message) {
  console.error(`[check-dist-eas-node-undici] ${message}`)
  process.exit(1)
}

if (!existsSync(distFile)) fail('packages/eas/dist/node.js is missing; build @seedprotocol/eas first')
const code = readFileSync(distFile, 'utf8')

if (code.includes('createRequire')) {
  fail('dist/node.js uses createRequire; bundlers and @vercel/nft cannot follow it. Use a literal dynamic import.')
}
const literalImport = new RegExp(`\\bimport\\(\\s*(['"\`])${AGENT_MODULE.replace(/[./]/g, '\\$&')}\\1\\s*\\)`)
if (!literalImport.test(code)) fail(`dist/node.js has no literal import("${AGENT_MODULE}")`)

try {
  createRequire(path.join(easDir, 'package.json')).resolve(AGENT_MODULE)
} catch (error) {
  fail(`${AGENT_MODULE} does not resolve from packages/eas: ${error.message}`)
}

console.log(`[check-dist-eas-node-undici] dist/node.js loads ${AGENT_MODULE} with a literal dynamic import`)
