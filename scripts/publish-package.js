#!/usr/bin/env node
/**
 * Publish a package to npm with SDK (and publish→React) dependency validation
 *
 * Usage: node scripts/publish-package.js [-f] <package>
 *
 * Packages: sdk, react, feed, publish, cli, ghost
 *
 * - If publishing anything except 'sdk', checks that @seedprotocol/sdk@<version> is published
 * - If SDK version is not published, prompts to publish it first
 * - If publishing 'publish', also checks that @seedprotocol/react@<same version> is published
 * - If React version is not published, prompts to publish it first
 * - If user declines, script exits
 * - If user accepts (or dependencies already published), publishes the requested package
 * - Use -f or --force to skip running tests before build
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import * as readline from 'readline'
import { withPublishableWorkspaceManifest } from './workspace-publish-manifest.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

const VALID_PACKAGES = ['sdk', 'react', 'feed', 'publish', 'cli', 'ghost']

function readPackageJson(path) {
  const content = readFileSync(path, 'utf-8')
  return JSON.parse(content)
}

function getSdkVersion() {
  const sdkPackagePath = join(rootDir, 'packages', 'sdk', 'package.json')
  const sdkPackage = readPackageJson(sdkPackagePath)
  return sdkPackage.version
}

function getReactVersion() {
  const reactPackagePath = join(rootDir, 'packages', 'react', 'package.json')
  const reactPackage = readPackageJson(reactPackagePath)
  return reactPackage.version
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
 * Check if a specific version of @seedprotocol/react is published on npm
 */
function isReactVersionPublished(version) {
  try {
    execSync(`npm view @seedprotocol/react@${version} version`, {
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

/** Build only (no npm publish); must stay in sync with packages/sdk build:publish inner command */
const SDK_BUILD_ONLY_CMD =
  'bun run sync-versions && cd packages/sdk && rm -rf dist && NODE_ENV=production rollup -c && node ../../scripts/check-dist-fragile-dynamic-imports.js --fail && tsc -p tsconfig.declarations.json && node ../../scripts/rewrite-dts-alias-to-relative.js && node ../../scripts/check-dist-no-alias.js'

async function publishSdk(skipTests = false) {
  const sdkDir = join(rootDir, 'packages', 'sdk')
  console.log('\n📦 Publishing @seedprotocol/sdk...\n')
  if (skipTests) {
    await runCommand(`node scripts/build-with-tests.js -f "${SDK_BUILD_ONLY_CMD}"`, { cwd: rootDir })
  } else {
    await runCommand('bun run build:publish', { cwd: sdkDir })
  }
  await withPublishableWorkspaceManifest(rootDir, 'packages/sdk', async () => {
    await runCommand('npm publish --access public', { cwd: sdkDir })
  })
  console.log('\n✅ SDK published successfully!\n')
}

async function publishReact(skipTests = false) {
  const reactDir = join(rootDir, 'packages', 'react')
  console.log('\n📦 Publishing @seedprotocol/react...\n')
  if (!skipTests) {
    await runCommand('node scripts/build-with-tests.js "true"', { cwd: rootDir })
  }
  await withPublishableWorkspaceManifest(rootDir, 'packages/react', async () => {
    await runCommand('npm publish --access public', { cwd: reactDir })
  })
  console.log('\n✅ @seedprotocol/react published successfully!\n')
}

async function publishPackage(packageName) {
  const packageDir = join(rootDir, 'packages', packageName)
  console.log(`\n📦 Publishing @seedprotocol/${packageName}...\n`)
  await withPublishableWorkspaceManifest(rootDir, `packages/${packageName}`, async () => {
    await runCommand('npm publish', { cwd: packageDir })
  })
  console.log(`\n✅ @seedprotocol/${packageName} published successfully!\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const forceIndex = args.findIndex((arg) => arg === '-f' || arg === '--force')
  const skipTests = forceIndex !== -1
  const packageArg = args.filter((_, i) => i !== forceIndex)[0]

  if (!packageArg || !VALID_PACKAGES.includes(packageArg)) {
    console.error('❌ Error: Invalid or missing package name')
    console.error(`Usage: node scripts/publish-package.js [-f] <package>`)
    console.error(`Valid packages: ${VALID_PACKAGES.join(', ')}`)
    console.error(`  -f, --force  Skip running tests before build`)
    process.exit(1)
  }

  const sdkVersion = getSdkVersion()
  console.log(`[Publish] Target package: ${packageArg}`)
  console.log(`[Publish] SDK version in monorepo: ${sdkVersion}`)
  if (skipTests) {
    console.log('[Publish] -f flag: skipping tests before build')
  }

  if (packageArg !== 'sdk') {
    console.log('\n[Publish] Checking if @seedprotocol/sdk is published on npm...')
    const sdkPublished = await isSdkVersionPublished(sdkVersion)

    if (!sdkPublished) {
      console.log(`\n⚠️  @seedprotocol/sdk@${sdkVersion} is not published on npm.`)
      console.log('   The feed, publish, cli, and ghost packages depend on it, so it must be published first.\n')

      const answer = await prompt('Do you want to publish the SDK now? (y/n): ')

      if (answer !== 'y' && answer !== 'yes') {
        console.log('\nAborted. Publish the SDK first, then run this script again.')
        process.exit(1)
      }

      try {
        await publishSdk(skipTests)
      } catch (error) {
        console.error('\n❌ SDK publish failed:', error.message)
        process.exit(1)
      }
    } else {
      console.log(`✅ @seedprotocol/sdk@${sdkVersion} is already published.\n`)
    }
  }

  if (packageArg === 'publish') {
    const reactVersion = getReactVersion()
    console.log(`[Publish] React version in monorepo: ${reactVersion}`)
    console.log('\n[Publish] Checking if @seedprotocol/react is published on npm...')
    const reactPublished = await isReactVersionPublished(reactVersion)

    if (!reactPublished) {
      console.log(`\n⚠️  @seedprotocol/react@${reactVersion} is not published on npm.`)
      console.log('   @seedprotocol/publish depends on it, so it must be published first.\n')

      const answer = await prompt('Do you want to publish @seedprotocol/react now? (y/n): ')

      if (answer !== 'y' && answer !== 'yes') {
        console.log('\nAborted. Publish @seedprotocol/react first, then run this script again.')
        process.exit(1)
      }

      try {
        await publishReact(skipTests)
      } catch (error) {
        console.error('\n❌ @seedprotocol/react publish failed:', error.message)
        process.exit(1)
      }
    } else {
      console.log(`✅ @seedprotocol/react@${reactVersion} is already published.\n`)
    }
  }

  if (packageArg === 'sdk') {
    try {
      await publishSdk(skipTests)
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
