#!/usr/bin/env node
/**
 * Point the real dist-tag at a version once every package is published under
 * the staging tag, then remove the staging tags. See docs/RELEASING.md.
 *
 * Environment (from ci-version.js outputs):
 *   RELEASE_VERSION, RELEASE_DIST_TAG, RELEASE_CHANNEL (release | preview),
 *   RELEASE_STAGING_TAG, RELEASE_BRANCH (preview only), GITHUB_SHA
 *   RELEASE_REGISTRY_WAIT_MS: how long to keep retrying each package's tag write
 *   (default 10 minutes)
 *
 * Runs only after the publish job succeeded, which means npm accepted every
 * package at this version. It doesn't wait for the version to show up in `npm view`:
 * those reads lagged publishes by 3–8 minutes in v0.7.2 and #65. It reads the current
 * tags from the dist-tags endpoint and writes the tag straight away, retrying only
 * a write that fails.
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
  decideLatest,
  fetchDistTags,
  listRemoteBranches,
  npmWrite,
  retryUntil,
  stagingTagsToRemove,
} from './release-channel.js'

const PACKAGES = PUBLISH_ORDER.map((name) => `@seedprotocol/${name}`)

const RETRY_INTERVAL_MS = 15_000
// Per package, so one slow package can't use up the others' time.
const REGISTRY_WAIT_MS = Number(process.env.RELEASE_REGISTRY_WAIT_MS ?? 10 * 60_000)
// `npm dist-tag rm` refuses a tag its own read doesn't show yet. Shared by all
// packages: on a re-run the staging tags are already gone, and each would wait the full time.
const STAGING_REMOVE_WAIT_MS = 2 * 60_000

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
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
 * Run an npm write, retrying until `deadline`.
 * @param {string[]} args
 * @param {number} deadline
 */
function npmWriteWithRetry(args, deadline) {
  return retryUntil(() => npmWrite(args), {
    deadline,
    intervalMs: RETRY_INTERVAL_MS,
    onRetry: (_error, attempt) =>
      console.log(`[promote] npm ${args.join(' ')} failed (attempt ${attempt}); retrying`),
  })
}

async function main() {
  const version = requireEnv('RELEASE_VERSION')
  const distTag = requireEnv('RELEASE_DIST_TAG')
  const channel = requireEnv('RELEASE_CHANNEL')
  const sha = requireEnv('GITHUB_SHA')
  const stagingTag = process.env.RELEASE_STAGING_TAG

  if (channel === 'preview' && distTag === 'latest') {
    throw new Error('Refusing to point latest at a preview build')
  }

  const tagsByPackage = new Map(
    await Promise.all(PACKAGES.map(async (packageName) => [packageName, await fetchDistTags(packageName)])),
  )

  const previewDecision = channel === 'preview' ? decidePreview(requireEnv('RELEASE_BRANCH'), sha) : null
  const results = []

  // In publish order, so if a write still fails, the packages left on the old version
  // are dependents of the ones that moved, never the other way round.
  for (const packageName of PACKAGES) {
    const tags = tagsByPackage.get(packageName)
    const decision = previewDecision ?? decideLatest(version, tags.latest)
    let status
    if (!decision.move) {
      status = `left ${distTag} at ${tags[distTag] ?? '(unset)'}: ${decision.reason}`
    } else if (tags[distTag] === version) {
      status = `${distTag} already at ${version}`
    } else {
      try {
        await npmWriteWithRetry(['dist-tag', 'add', `${packageName}@${version}`, distTag], Date.now() + REGISTRY_WAIT_MS)
      } catch (error) {
        throw new Error(
          `could not point ${distTag} at ${packageName}@${version}: ${error.message}. ` +
            `Already pointing at it: ${results.filter((r) => r.moved).map((r) => r.packageName).join(', ') || 'none'}. ` +
            'Re-run the promote job to finish.',
        )
      }
      status = `${distTag} → ${version}`
    }
    results.push({ packageName, status, moved: decision.move })
    console.log(`[promote] ${packageName}: ${status}`)
  }

  const stagingDeadline = Date.now() + STAGING_REMOVE_WAIT_MS
  for (const packageName of PACKAGES) {
    for (const tag of stagingTagsToRemove({ tags: tagsByPackage.get(packageName), version, stagingTag })) {
      // A leftover staging tag is untidy, not broken; don't fail after the real tag moved.
      try {
        await npmWriteWithRetry(['dist-tag', 'rm', packageName, tag], stagingDeadline)
        console.log(`[promote] ${packageName}: removed staging tag ${tag}`)
      } catch (error) {
        console.warn(`[promote] ${packageName}: could not remove staging tag ${tag}: ${error.message}`)
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
