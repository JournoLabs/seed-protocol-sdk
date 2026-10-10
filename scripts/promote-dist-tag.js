#!/usr/bin/env node
/**
 * Point the real dist-tag at a version once every package is published under
 * the staging tag, then remove the staging tags. See docs/RELEASING.md.
 *
 * Environment (from ci-version.js outputs):
 *   RELEASE_VERSION, RELEASE_DIST_TAG, RELEASE_CHANNEL (release | preview),
 *   RELEASE_BRANCH (preview only), GITHUB_SHA
 *
 * When the tag moves:
 * - preview: only if this run's SHA is still the branch head on the remote
 *   (`git ls-remote`), so re-runs of old commits, amends and force-pushes never
 *   leave the tag on a commit the branch no longer has.
 * - release: only forward; re-running an old release tag never moves `latest` back.
 *
 * Staging tags (ci-*) pointing at this version are removed either way.
 * Safe to re-run. Writes the `bun add` lines to GITHUB_STEP_SUMMARY when set.
 */

import { appendFileSync } from 'fs'
import {
  PUBLISH_ORDER,
  STAGING_TAG_PREFIX,
  compareStable,
  getDistTags,
  listRemoteBranches,
  npm,
  npmWrite,
} from './release-channel.js'

const PACKAGES = PUBLISH_ORDER.map((name) => `@seedprotocol/${name}`)

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
}

/**
 * Registry reads can lag just behind a publish; retry before giving up.
 * @param {string} packageName
 * @param {string} version
 */
async function waitForVersion(packageName, version) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      npm(['view', `${packageName}@${version}`, 'version', '--prefer-online'], { capture: true })
      return
    } catch {
      if (attempt === 6) break
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
  }
  throw new Error(`${packageName}@${version} is not on the registry; not moving any tags`)
}

/**
 * @returns {{ move: boolean, reason: string }}
 */
function decidePreview(branch, sha) {
  const head = listRemoteBranches().get(branch)
  if (!head) return { move: false, reason: `branch "${branch}" no longer exists on the remote` }
  if (head !== sha) return { move: false, reason: `branch head is now ${head.slice(0, 7)}, not this commit` }
  return { move: true, reason: 'this commit is the branch head' }
}

/**
 * @returns {{ move: boolean, reason: string }}
 */
function decideRelease(version, current) {
  if (!current) return { move: true, reason: 'no current latest' }
  if (compareStable(version, current) >= 0) return { move: true, reason: `current latest is ${current}` }
  return { move: false, reason: `latest is already newer (${current})` }
}

async function main() {
  const version = requireEnv('RELEASE_VERSION')
  const distTag = requireEnv('RELEASE_DIST_TAG')
  const channel = requireEnv('RELEASE_CHANNEL')
  const sha = requireEnv('GITHUB_SHA')

  if (channel === 'preview' && distTag === 'latest') {
    throw new Error('Refusing to point latest at a preview build')
  }

  for (const packageName of PACKAGES) {
    await waitForVersion(packageName, version)
  }

  const tagsByPackage = new Map(PACKAGES.map((name) => [name, getDistTags(name)]))

  const previewDecision = channel === 'preview' ? decidePreview(requireEnv('RELEASE_BRANCH'), sha) : null
  const results = []

  for (const packageName of PACKAGES) {
    const tags = tagsByPackage.get(packageName)
    const decision = previewDecision ?? decideRelease(version, tags.latest)
    let status
    if (!decision.move) {
      status = `left ${distTag} at ${tags[distTag] ?? '(unset)'}: ${decision.reason}`
    } else if (tags[distTag] === version) {
      status = `${distTag} already at ${version}`
    } else {
      npmWrite(['dist-tag', 'add', `${packageName}@${version}`, distTag])
      status = `${distTag} → ${version}`
    }
    results.push({ packageName, status, moved: decision.move })
    console.log(`[promote] ${packageName}: ${status}`)
  }

  for (const packageName of PACKAGES) {
    const tags = tagsByPackage.get(packageName)
    for (const [tag, tagged] of Object.entries(tags)) {
      if (tag.startsWith(STAGING_TAG_PREFIX) && tagged === version) {
        npmWrite(['dist-tag', 'rm', packageName, tag])
        console.log(`[promote] ${packageName}: removed staging tag ${tag}`)
      }
    }
  }

  writeSummary({ version, distTag, results })
}

function writeSummary({ version, distTag, results }) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  const moved = results.every((r) => r.moved)
  const lines = [
    `### Published \`${version}\``,
    '',
    moved
      ? `dist-tag \`${distTag}\` points at this version.`
      : `dist-tag \`${distTag}\` was **not** moved: ${results.find((r) => !r.moved).status}`,
    '',
    '```bash',
    ...PACKAGES.map((name) => `bun add ${name}@${version}`),
    '```',
    '',
    '<details><summary>Per-package dist-tag status</summary>',
    '',
    ...results.map((r) => `- \`${r.packageName}\`: ${r.status}`),
    '',
    '</details>',
    '',
  ]
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'))
}

main().catch((error) => {
  console.error(`[promote] ${error.message}`)
  process.exit(1)
})
