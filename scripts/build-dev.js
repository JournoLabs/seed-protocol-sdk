#!/usr/bin/env node
/**
 * Build script that runs tests before building unless --force or -f flag is provided
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

// Check for force flag
const args = process.argv.slice(2)
const forceFlag = args.includes('--force') || args.includes('-f')

/**
 * Runs a command and returns a promise that resolves/rejects based on exit code
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: rootDir,
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
      await runCommand('bun', ['run', 'test'])
      console.log('\n✅ All tests passed! Proceeding with build...\n')
    } else {
      console.log('⚠️  Force flag detected. Skipping tests...\n')
    }

    console.log('Building...')
    await runCommand('rm', ['-rf', 'dist'])
    await runCommand('rollup', ['-c'], {
      env: { ...process.env, NODE_ENV: 'production' },
    })

    console.log('\n✅ Build complete!')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()

