#!/usr/bin/env node
/**
 * Generalized build script that runs tests before building unless --force or -f flag is provided
 * Usage: node scripts/build-with-tests.js [--force|-f] <build-command>
 * 
 * Examples:
 *   node scripts/build-with-tests.js "tsc -p tsconfig.json"
 *   node scripts/build-with-tests.js -f "bun run clean && tsc -p tsconfig.json"
 *   node scripts/build-with-tests.js "rm -rf dist && NODE_ENV=production rollup -c"
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
const forceFlag = forceFlagIndex !== -1

// Extract build command(s) - everything except the force flag
const buildCommandArgs = forceFlag
  ? args.filter((_, index) => index !== forceFlagIndex)
  : args

if (buildCommandArgs.length === 0) {
  console.error('❌ Error: No build command provided')
  console.error('Usage: node scripts/build-with-tests.js [--force|-f] <build-command>')
  process.exit(1)
}

// Join remaining args to form the build command (handles commands with && and spaces)
const buildCommand = buildCommandArgs.join(' ')

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
    if (!forceFlag) {
      console.log('Running tests before build...')
      console.log('(Use --force or -f to skip tests)\n')
      await runCommand('bun run test')
      console.log('\n✅ All tests passed! Proceeding with build...\n')
    } else {
      console.log('⚠️  Force flag detected. Skipping tests...\n')
    }

    console.log(`Executing build command: ${buildCommand}\n`)
    await runCommand(buildCommand)

    console.log('\n✅ Build complete!')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()
