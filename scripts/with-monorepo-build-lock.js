#!/usr/bin/env node
/**
 * Exclusive lock around package builds that rimraf `dist`.
 * Prevents concurrent build:sdk / build:all from deleting a dependency's dist
 * while another package's tsc is resolving it (TS2307 flakiness).
 *
 * Usage: node scripts/with-monorepo-build-lock.js <build-command>
 */
import { spawn } from 'child_process'
import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const lockPath = join(rootDir, 'node_modules/.cache/seed-protocol-build.lock')
const maxWaitMs = 10 * 60 * 1000
const staleMs = 2 * 60 * 60 * 1000

const bunPaths = [
  process.env.BUN_INSTALL,
  join(process.env.HOME || '', '.bun', 'bin'),
  '/Users/admin/.bun/bin',
].filter(Boolean)
const pathWithBun = [...new Set(bunPaths)].join(':') + (process.env.PATH ? ':' + process.env.PATH : '')

const buildCommand = process.argv.slice(2).join(' ')
if (!buildCommand) {
  console.error('Usage: node scripts/with-monorepo-build-lock.js <build-command>')
  process.exit(1)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function acquireLock() {
  fs.mkdirSync(dirname(lockPath), { recursive: true })
  const started = Date.now()
  let waitedMs = 0
  while (Date.now() - started < maxWaitMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx')
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now(), cmd: buildCommand }))
      fs.closeSync(fd)
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let holder = null
      try {
        holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      } catch {
        try {
          fs.unlinkSync(lockPath)
        } catch {
          /* ignore */
        }
        continue
      }
      const stale = !isPidAlive(holder.pid) || Date.now() - holder.startedAt > staleMs
      if (stale) {
        try {
          fs.unlinkSync(lockPath)
        } catch {
          /* ignore */
        }
        continue
      }
      if (waitedMs === 0) {
        console.warn(
          `⏳ Waiting for monorepo build lock (held by pid ${holder.pid}: ${holder.cmd || 'unknown'})...`,
        )
      }
      await sleep(200)
      waitedMs = Date.now() - started
    }
  }
  throw new Error(`Timeout waiting for monorepo build lock after ${maxWaitMs}ms`)
}

function releaseLock() {
  try {
    const holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    if (holder.pid === process.pid) {
      fs.unlinkSync(lockPath)
    }
  } catch {
    /* ignore */
  }
}

function runCommand(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      stdio: 'inherit',
      shell: true,
      cwd: rootDir,
      env: { ...process.env, PATH: pathWithBun, ...extraEnv },
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command failed with exit code ${code}`))
    })
    proc.on('error', reject)
  })
}

async function main() {
  // Reentrant: build:all holds the lock while nested build:eas/arweave/query also wrap.
  if (process.env.SEED_MONOREPO_BUILD_LOCK === '1') {
    await runCommand(buildCommand)
    return
  }

  await acquireLock()
  try {
    // Skip nested package pre-build test suites while holding the lock.
    // Otherwise build:sdk → build:query → vitest → npm run build → build:sdk deadlocks.
    await runCommand(buildCommand, {
      SEED_MONOREPO_BUILD_LOCK: '1',
      SKIP_TESTS: '1',
    })
  } finally {
    releaseLock()
  }
}

main().catch((error) => {
  if (process.env.SEED_MONOREPO_BUILD_LOCK !== '1') releaseLock()
  console.error('❌ Error:', error.message)
  process.exit(1)
})
