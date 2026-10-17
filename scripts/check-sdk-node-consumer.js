#!/usr/bin/env node
/**
 * Uses the built @seedprotocol/sdk the way an installed Node app does, from a
 * working directory that has no node_modules (hoisted monorepos, packaged
 * Electron apps, scripts run from elsewhere):
 *
 * - import() and require() of "." and "./node" with no --import hook
 * - client.init with a filesDir, which must find the SDK's own drizzle
 *   migrations without looking under the working directory
 * - from a read-only working directory (a packaged Electron app's is `/`), with
 *   the database in a folder that doesn't exist yet: init, stop, init again
 *   with another config, stop, and then the process exits on its own
 *
 * The app links node_modules/@seedprotocol/sdk to packages/sdk, so this needs
 * a built dist. Exits 0 on success; exits 1 and prints the failure otherwise.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sdkDir = path.join(root, 'packages', 'sdk')

if (!fs.existsSync(path.join(sdkDir, 'dist', 'main.js'))) {
  console.error('[check-sdk-node-consumer] packages/sdk/dist is missing; build the SDK first')
  process.exit(1)
}

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-sdk-consumer-')))
const appDir = path.join(tmp, 'app')
const elsewhere = path.join(tmp, 'elsewhere')
const filesDir = path.join(tmp, 'data')
fs.mkdirSync(path.join(appDir, 'node_modules', '@seedprotocol'), { recursive: true })
fs.mkdirSync(elsewhere)
fs.symlinkSync(sdkDir, path.join(appDir, 'node_modules', '@seedprotocol', 'sdk'), 'dir')
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' }))

const script = path.join(appDir, 'consumer.mjs')
fs.writeFileSync(
  script,
  `
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const esm = await import('@seedprotocol/sdk')
const cjs = require('@seedprotocol/sdk')
const cjsNode = require('@seedprotocol/sdk/node')
for (const [label, mod] of [['import .', esm], ['require .', cjs], ['require ./node', cjsNode]]) {
  if (typeof mod.client?.init !== 'function') throw new Error(label + ': client.init missing')
}
if (esm.client !== cjs.client) throw new Error('import and require returned different SDK instances')

await esm.client.init({ config: { filesDir: ${JSON.stringify(filesDir)} } })
console.log('ok')
process.exit(0)
`,
)

const lifecycleScript = path.join(appDir, 'lifecycle.mjs')
const readOnlyCwd = path.join(tmp, 'read-only')
fs.mkdirSync(readOnlyCwd)
fs.writeFileSync(
  lifecycleScript,
  `
const { client } = await import('@seedprotocol/sdk')
const first = ${JSON.stringify(path.join(tmp, 'first'))}
const second = ${JSON.stringify(path.join(tmp, 'second'))}
await client.init({ config: { filesDir: first, dbConfig: { dbUrl: ${JSON.stringify(path.join(tmp, 'not-yet', 'db', 'app.db'))} } } })
client.stop()
if (client.isInitialized()) throw new Error('isInitialized() is true after stop()')
await client.init({ config: { filesDir: second } })
if (!client.isInitialized()) throw new Error('init after stop() did not initialise')
const filesDir = client.getService().getSnapshot().context.filesDir
if (filesDir !== second) throw new Error('init after stop() kept the old filesDir: ' + filesDir)
client.stop()
console.log('ok')
// No process.exit: open handles would keep the process alive.
`,
)

const run = (file, cwd) =>
  spawnSync(process.execPath, [file], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 120_000,
  })

const result = run(script, elsewhere)
fs.chmodSync(readOnlyCwd, 0o555)
const lifecycle = run(lifecycleScript, readOnlyCwd)
fs.chmodSync(readOnlyCwd, 0o755)
const leftDotSeed = fs.existsSync(path.join(readOnlyCwd, '.seed'))
fs.rmSync(tmp, { recursive: true, force: true })

const report = (message, r) => {
  console.error(`[check-sdk-node-consumer] ${message}`)
  console.error((r.stderr || r.stdout || String(r.error)).split('\n').slice(0, 20).join('\n'))
  process.exit(1)
}
if (result.status !== 0 || !result.stdout.includes('ok')) {
  report('the SDK failed for a Node consumer outside the app directory', result)
}
if (lifecycle.signal) {
  report('the process did not exit on its own after client.stop() (open handles)', lifecycle)
}
if (lifecycle.status !== 0 || !lifecycle.stdout.includes('ok') || leftDotSeed) {
  report('init/stop/init from a read-only working directory failed', lifecycle)
}
console.log('[check-sdk-node-consumer] import, require and client.init work from another working directory')
console.log('[check-sdk-node-consumer] init, stop and re-init work from a read-only directory, and the process exits')
