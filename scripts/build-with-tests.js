#!/usr/bin/env node
/**
 * Generalized build script that runs tests before building unless --force or -f flag is provided
 * Usage: node scripts/build-with-tests.js [--force|-f] <build-command>
 *
 * Examples:
 *   node scripts/build-with-tests.js "tsc -p tsconfig.json"
 *   node scripts/build-with-tests.js -f "bun run clean && tsc -p tsconfig.json"
 *   node scripts/build-with-tests.js "rm -rf dist && NODE_ENV=production rollup -c"
 *   bun run build:all -f   # -f is forwarded; nested build:* scripts also skip tests
 *
 * SKIP_TESTS=1 is set when -f/--force is used so nested build-with-tests invocations
 * (e.g. build:query inside build:all) also skip tests.
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

// Ensure bun is in PATH when spawning (shell may not inherit user's profile)
const bunPaths = [
  process.env.BUN_INSTALL,
  join(process.env.HOME || '', '.bun', 'bin'),
  '/Users/admin/.bun/bin',
].filter(Boolean)
const pathWithBun = [...new Set(bunPaths)].join(':') + (process.env.PATH ? ':' + process.env.PATH : '')

// Parse arguments
const args = process.argv.slice(2)
const forceFlagIndex = args.findIndex(arg => arg === '--force' || arg === '-f')
const forceFromArgs = forceFlagIndex !== -1
const forceFromEnv = process.env.SKIP_TESTS === '1' || process.env.SKIP_TESTS === 'true'
const forceFlag = forceFromArgs || forceFromEnv

// Extract build command(s) - everything except the force flag
const buildCommandArgs = forceFromArgs
  ? args.filter((_, index) => index !== forceFlagIndex)
  : args

if (buildCommandArgs.length === 0) {
  console.error('❌ Error: No build command provided')
  console.error('Usage: node scripts/build-with-tests.js [--force|-f] <build-command>')
  process.exit(1)
}

// Join remaining args to form the build command (handles commands with && and spaces)
const buildCommand = buildCommandArgs.join(' ')

// Propagate skip to nested build-with-tests.js (e.g. build:all → build:query)
if (forceFlag) {
  process.env.SKIP_TESTS = '1'
}

/**
 * Runs a command and returns a promise that resolves/rejects based on exit code
 */
function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      stdio: 'inherit',
      shell: true,
      cwd: rootDir,
      env: { ...process.env, PATH: pathWithBun },
      ...options,
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })
  })
}

async function main() {
  try {
    // Under an active monorepo build lock, never start another full test suite
    // (integration tests can re-enter build:sdk and deadlock on the lock).
    const underBuildLock = process.env.SEED_MONOREPO_BUILD_LOCK === '1'
    if (!forceFlag && !underBuildLock) {
      console.log('Running tests before build...')
      console.log('(Use --force or -f to skip tests)\n')
      await runCommand('bun run test')
      console.log('\n✅ All tests passed! Proceeding with build...\n')
      // Nested build:* scripts (e.g. build:query inside build:all) must not re-run tests.
      process.env.SKIP_TESTS = '1'
    } else if (underBuildLock) {
      console.log('⚠️  Nested build under monorepo lock — skipping tests...\n')
    } else {
      console.log('⚠️  Force flag detected. Skipping tests...\n')
    }

    console.log(`Executing build command: ${buildCommand}\n`)
    // Serialize package builds that rimraf dist so concurrent build:sdk/build:all
    // cannot delete a dependency's types while another package's tsc is resolving them.
    const lockScript = join(rootDir, 'scripts/with-monorepo-build-lock.js')
    await runCommand(`node ${JSON.stringify(lockScript)} ${JSON.stringify(buildCommand)}`)

    console.log('\n✅ Build complete!')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()
