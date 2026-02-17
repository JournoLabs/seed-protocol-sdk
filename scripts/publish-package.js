#!/usr/bin/env node
/**
 * Publish a package to npm with SDK dependency validation
 *
 * Usage: node scripts/publish-package.js <package>
 *
 * Packages: sdk, feed, publish, cli
 *
 * - If publishing 'feed', 'publish', or 'cli', checks that @seedprotocol/sdk@<version> is published
 * - If SDK version is not published, prompts to publish it first
 * - If user declines, script exits
 * - If user accepts (or SDK already published), publishes the requested package
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import * as readline from 'readline'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

const VALID_PACKAGES = ['sdk', 'feed', 'publish', 'cli']

function readPackageJson(path) {
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content)
}

function getSdkVersion() {
  const sdkPackagePath = join(rootDir, 'packages', 'sdk', 'package.json')
  const sdkPackage = readPackageJson(sdkPackagePath)
  return sdkPackage.version
}

/**
 * Check if a specific version of @seedprotocol/sdk is published on npm
 */
function isSdkVersionPublished(version) {
  try {
    execSync(`npm view @seedprotocol/sdk@${version} version`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Prompt user for yes/no input
 */
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

/**
 * Run a command and return a promise that resolves/rejects based on exit code
 */
function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      stdio: 'inherit',
      shell: true,
      cwd: options.cwd || rootDir,
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

async function publishSdk() {
  console.log('\n📦 Publishing @seedprotocol/sdk...\n')
  await runCommand('bun run build:publish', { cwd: join(rootDir, 'packages', 'sdk') })
  console.log('\n✅ SDK published successfully!\n')
}

async function publishPackage(packageName) {
  const packageDir = join(rootDir, 'packages', packageName)
  console.log(`\n📦 Publishing @seedprotocol/${packageName}...\n`)
  await runCommand('npm publish', { cwd: packageDir })
  console.log(`\n✅ @seedprotocol/${packageName} published successfully!\n`)
}

async function main() {
  const packageArg = process.argv[2]

  if (!packageArg || !VALID_PACKAGES.includes(packageArg)) {
    console.error('❌ Error: Invalid or missing package name')
    console.error(`Usage: node scripts/publish-package.js <package>`)
    console.error(`Valid packages: ${VALID_PACKAGES.join(', ')}`)
    process.exit(1)
  }

  const sdkVersion = getSdkVersion()
  console.log(`[Publish] Target package: ${packageArg}`)
  console.log(`[Publish] SDK version in monorepo: ${sdkVersion}`)

  if (packageArg !== 'sdk') {
    console.log('\n[Publish] Checking if @seedprotocol/sdk is published on npm...')
    const sdkPublished = await isSdkVersionPublished(sdkVersion)

    if (!sdkPublished) {
      console.log(`\n⚠️  @seedprotocol/sdk@${sdkVersion} is not published on npm.`)
      console.log('   The feed, publish, and cli packages depend on it, so it must be published first.\n')

      const answer = await prompt('Do you want to publish the SDK now? (y/n): ')

      if (answer !== 'y' && answer !== 'yes') {
        console.log('\nAborted. Publish the SDK first, then run this script again.')
        process.exit(1)
      }

      try {
        await publishSdk()
      } catch (error) {
        console.error('\n❌ SDK publish failed:', error.message)
        process.exit(1)
      }
    } else {
      console.log(`✅ @seedprotocol/sdk@${sdkVersion} is already published.\n`)
    }
  }

  if (packageArg === 'sdk') {
    try {
      await publishSdk()
    } catch (error) {
      console.error('\n❌ SDK publish failed:', error.message)
      process.exit(1)
    }
  } else {
    try {
      await publishPackage(packageArg)
    } catch (error) {
      console.error(`\n❌ @seedprotocol/${packageArg} publish failed:`, error.message)
      process.exit(1)
    }
  }

  process.exit(0)
}

main()
