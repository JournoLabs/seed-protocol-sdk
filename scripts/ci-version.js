#!/usr/bin/env node
/**
 * Work out the version and dist-tag a CI run publishes. See docs/RELEASING.md.
 *
 * Reads GITHUB_REF, GITHUB_SHA and MAIN_BRANCH (default "main") from the
 * environment and the committed version from packages/sdk/package.json.
 * Writes version, dist_tag, staging_tag, channel and branch to GITHUB_OUTPUT
 * when set, and always prints them.
 *
 * Fails when:
 * - a release tag doesn't match the committed version
 * - the clone is shallow (the commit count would be wrong)
 * - another live branch cleans to the same dist-tag
 *
 * Local dry run:
 *   GITHUB_REF=refs/heads/$(git branch --show-current) GITHUB_SHA=$(git rev-parse HEAD) node scripts/ci-version.js
 */

import { appendFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { findCollidingBranches, git, listRemoteBranches, resolveRelease } from './release-channel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

function main() {
  const ref = process.env.GITHUB_REF
  const sha = process.env.GITHUB_SHA
  const mainBranch = process.env.MAIN_BRANCH || 'main'
  if (!ref || !sha) {
    throw new Error('GITHUB_REF and GITHUB_SHA must be set')
  }

  const sdkPackage = JSON.parse(readFileSync(join(rootDir, 'packages', 'sdk', 'package.json'), 'utf-8'))
  const baseVersion = sdkPackage.version

  let commitCount
  if (ref.startsWith('refs/heads/')) {
    if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
      throw new Error('Shallow clone: the commit count would be wrong. Check out with fetch-depth: 0.')
    }
    commitCount = Number(git(['rev-list', '--count', sha]))
  }

  const release = resolveRelease({ ref, sha, baseVersion, commitCount, mainBranch })

  if (release.branch && release.branch !== mainBranch) {
    const collisions = findCollidingBranches(release.branch, listRemoteBranches().keys(), mainBranch)
    if (collisions.length > 0) {
      throw new Error(
        `Branch "${release.branch}" and ${collisions.map((b) => `"${b}"`).join(', ')} would all publish to ` +
          `dist-tag "${release.distTag}". Rename one of them.`,
      )
    }
  }

  const outputs = {
    version: release.version,
    dist_tag: release.distTag,
    staging_tag: release.stagingTag,
    channel: release.channel,
    branch: release.branch ?? '',
  }
  for (const [key, value] of Object.entries(outputs)) {
    console.log(`${key}=${value}`)
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    )
  }
}

try {
  main()
} catch (error) {
  console.error(`[ci-version] ${error.message}`)
  process.exit(1)
}
