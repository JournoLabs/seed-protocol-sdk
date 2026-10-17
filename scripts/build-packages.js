#!/usr/bin/env node
/**
 * Runs `bun run build` in each named package directory, in BUILD_ORDER, stopping at the
 * first failure. With no arguments it builds every package in BUILD_ORDER.
 *
 * Usage: node scripts/build-packages.js [package-dir...]
 *
 * Packages build from each other's dist, so the order matters: bundler-core before vite and
 * next, eas, arweave and query before vite and sdk, and sdk before react, publish and
 * mapping. Callers wrap this in
 * with-monorepo-build-lock.js (directly or through build-with-tests.js) so a concurrent
 * build cannot delete a dist mid-build.
 */

import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const BUILD_ORDER = [
  // Inlined into vite and next at build time, so it builds first.
  'bundler-core',
  'eas',
  'arweave',
  'query',
  'feed',
  'feed-hyper',
  'gateway-hyper',
  'vite',
  'next',
  'sdk',
  'react',
  'publish',
  'mapping',
]

const bunPaths = [
  process.env.BUN_INSTALL,
  join(process.env.HOME || '', '.bun', 'bin'),
].filter(Boolean)
const pathWithBun = [...new Set(bunPaths)].join(':') + (process.env.PATH ? ':' + process.env.PATH : '')

function runBuild(dir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun run build', {
      stdio: 'inherit',
      shell: true,
      cwd: join(rootDir, 'packages', dir),
      env: { ...process.env, PATH: pathWithBun },
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`packages/${dir} build failed with exit code ${code}`))
    })
    proc.on('error', reject)
  })
}

async function main() {
  const requested = process.argv.slice(2)
  const unknown = requested.filter((dir) => !BUILD_ORDER.includes(dir))
  if (unknown.length > 0) {
    console.error(`Unknown package(s): ${unknown.join(', ')}. Known: ${BUILD_ORDER.join(', ')}`)
    process.exit(1)
  }
  const dirs = requested.length > 0 ? BUILD_ORDER.filter((dir) => requested.includes(dir)) : BUILD_ORDER
  for (const dir of dirs) {
    console.log(`\n▶ Building packages/${dir}\n`)
    await runBuild(dir)
  }
}

main().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})
