#!/usr/bin/env node
/**
 * Publish package(s) to npm with dependency validation.
 *
 * Usage:
 *   node scripts/publish-package.js [-f] [-y] <package>
 *   node scripts/publish-package.js [-f] [-y] all
 *   node scripts/publish-package.js [-f] [-y]          # same as "all" (used by bun run publish:all)
 *
 * Packages: eas, arweave, vite, query, sdk, feed, feed-hyper, gateway-hyper, react, publish, mapping
 *
 * Single-package mode:
 * - If publishing anything except 'sdk' / lean packages, checks that @seedprotocol/sdk@<version> is published
 * - If SDK version is not published, prompts to publish it first
 * - If publishing 'feed', also checks that @seedprotocol/query@<same version> is published
 * - If publishing 'feed-hyper', also checks that @seedprotocol/feed@<same version> is published
 * - If publishing 'publish', also checks that @seedprotocol/react@<same version> is published
 * - If React version is not published, prompts to publish it first
 * - If user declines, script exits
 *
 * All mode (`all` or no package arg):
 * - Publishes every supported package in dependency order
 * - Skips packages already published at the monorepo version (resume-safe)
 * - Prompts once before starting unless -y / --yes
 *
 * Flags:
 * - `-f` / `--force` — skip running tests before build (sdk / react paths)
 * - `-y` / `--yes` — skip the publish:all confirmation prompt
 *
 * Experimental packages (cli, webpack, ghost) are private and not publishable via this script.
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

/**
 * Dependency-safe publish order for a full release.
 * Keep in sync with real @seedprotocol/* package.json dependencies.
 */
const PUBLISH_ORDER = [
  'eas',
  'arweave',
  'vite',
  'query',
  'sdk',
  'feed',
  'feed-hyper',
  'gateway-hyper',
  'react',
  'publish',
  'mapping',
]

const VALID_PACKAGES = [...PUBLISH_ORDER]
const LEAN_PACKAGES = ['eas', 'arweave', 'vite']

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
 * Check if a specific version of an @seedprotocol package is on npm
 * @param {string} shortName - e.g. "sdk", "feed-hyper"
 * @param {string} version
 */
function isPackageVersionPublished(shortName, version) {
  try {
    execSync(`npm view @seedprotocol/${shortName}@${version} version`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

function isSdkVersionPublished(version) {
  return isPackageVersionPublished('sdk', version)
}

function isReactVersionPublished(version) {
  return isPackageVersionPublished('react', version)
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

/**
 * Publish one package (build + npm publish), without dependency prompts.
 * @param {string} packageName
 * @param {{ skipTests?: boolean }} options
 */
async function publishOne(packageName, { skipTests = false } = {}) {
  if (packageName === 'sdk') {
    await publishSdk(skipTests)
    return
  }
  if (packageName === 'react') {
    await publishReact(skipTests)
    return
  }
  await publishPackage(packageName)
}

/**
 * @param {string} packageArg
 * @param {{ skipTests?: boolean }} options
 */
async function ensureSinglePackageDependencies(packageArg, { skipTests = false } = {}) {
  const sdkVersion = getSdkVersion()

  if (packageArg !== 'sdk' && !LEAN_PACKAGES.includes(packageArg)) {
    console.log('\n[Publish] Checking if @seedprotocol/sdk is published on npm...')
    const sdkPublished = isSdkVersionPublished(sdkVersion)

    if (!sdkPublished) {
      console.log(`\n⚠️  @seedprotocol/sdk@${sdkVersion} is not published on npm.`)
      console.log('   Downstream packages depend on it, so it must be published first.\n')

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
    const reactPublished = isReactVersionPublished(reactVersion)

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

  if (packageArg === 'feed') {
    console.log('\n[Publish] Checking if @seedprotocol/query is published on npm...')
    const queryPublished = isPackageVersionPublished('query', sdkVersion)

    if (!queryPublished) {
      console.log(`\n⚠️  @seedprotocol/query@${sdkVersion} is not published on npm.`)
      console.log('   @seedprotocol/feed depends on it, so it must be published first.\n')
      console.log('Aborted. Publish @seedprotocol/query first, then run this script again.')
      process.exit(1)
    }
    console.log(`✅ @seedprotocol/query@${sdkVersion} is already published.\n`)
  }

  if (packageArg === 'feed-hyper') {
    console.log('\n[Publish] Checking if @seedprotocol/feed is published on npm...')
    const feedPublished = isPackageVersionPublished('feed', sdkVersion)

    if (!feedPublished) {
      console.log(`\n⚠️  @seedprotocol/feed@${sdkVersion} is not published on npm.`)
      console.log('   @seedprotocol/feed-hyper depends on it, so it must be published first.\n')
      console.log('Aborted. Publish @seedprotocol/feed first, then run this script again.')
      process.exit(1)
    }
    console.log(`✅ @seedprotocol/feed@${sdkVersion} is already published.\n`)
  }
}

/**
 * @param {{ skipTests?: boolean, assumeYes?: boolean }} options
 */
async function publishAll({ skipTests = false, assumeYes = false } = {}) {
  const version = getSdkVersion()
  console.log(`[Publish] Publishing all packages at version ${version}`)
  console.log(`[Publish] Order: ${PUBLISH_ORDER.join(' → ')}`)
  if (skipTests) {
    console.log('[Publish] -f flag: skipping tests before build')
  }

  if (!assumeYes) {
    const answer = await prompt(
      `\nPublish all ${PUBLISH_ORDER.length} packages at ${version}? Already-published packages will be skipped. (y/n): `,
    )
    if (answer !== 'y' && answer !== 'yes') {
      console.log('\nAborted.')
      process.exit(1)
    }
  }

  console.log('\n[Publish] Syncing package versions...')
  await runCommand('bun run sync-versions', { cwd: rootDir })

  const published = []
  const skipped = []

  for (const packageName of PUBLISH_ORDER) {
    if (isPackageVersionPublished(packageName, version)) {
      console.log(
        `\n⏭️  Skipping @seedprotocol/${packageName}@${version} (already on npm)\n`,
      )
      skipped.push(packageName)
      continue
    }

    console.log(
      `\n——— [${published.length + skipped.length + 1}/${PUBLISH_ORDER.length}] @seedprotocol/${packageName}@${version} ———\n`,
    )

    try {
      await publishOne(packageName, { skipTests })
      published.push(packageName)
    } catch (error) {
      console.error(`\n❌ @seedprotocol/${packageName} publish failed:`, error.message)
      console.error(
        `\nStopped after publishing: ${published.length ? published.join(', ') : '(none)'}` +
          (skipped.length ? `\nSkipped (already published): ${skipped.join(', ')}` : '') +
          `\nRemaining: ${PUBLISH_ORDER.filter((p) => !published.includes(p) && !skipped.includes(p)).join(', ')}`,
      )
      console.error('Re-run `bun run publish:all` to resume; already-published packages are skipped.')
      process.exit(1)
    }
  }

  console.log('\n✅ publish:all complete.')
  if (published.length) {
    console.log(`   Published: ${published.join(', ')}`)
  }
  if (skipped.length) {
    console.log(`   Skipped (already on npm): ${skipped.join(', ')}`)
  }
}

function printUsage(message) {
  if (message) {
    console.error(`❌ Error: ${message}`)
  }
  console.error(`Usage: node scripts/publish-package.js [-f] [-y] [<package>|all]`)
  console.error(`Valid packages: ${VALID_PACKAGES.join(', ')}, all`)
  console.error(`  (omit package or pass "all" to publish every package in dependency order)`)
  console.error(`  -f, --force  Skip running tests before build`)
  console.error(`  -y, --yes    Skip confirmation when publishing all`)
}

function printUsageAndExit(message) {
  printUsage(message)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const flags = new Set()
  const positionals = []
  for (const arg of args) {
    if (arg === '-f' || arg === '--force' || arg === '-y' || arg === '--yes') {
      flags.add(arg === '--force' ? '-f' : arg === '--yes' ? '-y' : arg)
    } else if (arg.startsWith('-')) {
      printUsageAndExit(`Unknown flag: ${arg}`)
    } else {
      positionals.push(arg)
    }
  }

  const skipTests = flags.has('-f')
  const assumeYes = flags.has('-y')
  const packageArg = positionals[0] || 'all'

  if (packageArg !== 'all' && !VALID_PACKAGES.includes(packageArg)) {
    printUsageAndExit(`Invalid package name: ${packageArg}`)
  }

  if (packageArg === 'all') {
    await publishAll({ skipTests, assumeYes })
    process.exit(0)
  }

  const sdkVersion = getSdkVersion()
  console.log(`[Publish] Target package: ${packageArg}`)
  console.log(`[Publish] SDK version in monorepo: ${sdkVersion}`)
  if (skipTests) {
    console.log('[Publish] -f flag: skipping tests before build')
  }

  await ensureSinglePackageDependencies(packageArg, { skipTests })

  try {
    await publishOne(packageArg, { skipTests })
  } catch (error) {
    console.error(`\n❌ @seedprotocol/${packageArg} publish failed:`, error.message)
    process.exit(1)
  }

  process.exit(0)
}

main()
