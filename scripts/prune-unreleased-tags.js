#!/usr/bin/env node
/**
 * After a release publishes, delete older release tags that never reached npm (a release that
 * failed before publishing and was skipped instead of retried), and work out where the
 * changelog starts. See docs/RELEASING.md.
 *
 * Env: RELEASE_VERSION (the version just released), GH_TOKEN (for `gh run list`),
 * RELEASE_DRY_RUN=1 to print the deletions instead.
 * Writes previous_tag to GITHUB_OUTPUT: the newest older tag whose version is on npm.
 *
 * Never fails the release: it is cleanup, so problems become warnings.
 */

import { appendFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { fetchPublishedVersionsByPackage, git, previousReleasedTag, unreleasedTags } from './release-channel.js'

/** True when a Release run for the tag is queued or running: it may still publish. */
function hasActiveRun(tag) {
  const out = execFileSync(
    'gh',
    ['run', 'list', '--workflow', 'release.yml', '--branch', tag, '--limit', '20', '--json', 'status'],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  return JSON.parse(out).some((run) => run.status !== 'completed')
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

async function main() {
  const released = process.env.RELEASE_VERSION
  if (!released) throw new Error('RELEASE_VERSION is not set')

  const byPackage = await fetchPublishedVersionsByPackage()
  const publishedVersions = new Set([...byPackage.values()].flatMap((versions) => [...versions]))
  const tags = git(['tag', '--list', 'v*']).split('\n').filter(Boolean)

  const previous = previousReleasedTag({ tags, released, publishedVersions })
  console.log(`Changelog starts at ${previous ?? 'the first commit'}.`)
  writeOutput('previous_tag', previous ?? '')

  const stale = unreleasedTags({ tags, released, publishedVersions })
  if (stale.length === 0) {
    console.log('No unreleased tags to remove.')
    return
  }
  for (const tag of stale) {
    try {
      if (hasActiveRun(tag)) {
        console.log(`Keeping ${tag}: its Release run is still going.`)
        continue
      }
      if (process.env.RELEASE_DRY_RUN === '1') {
        console.log(`[dry run] would delete ${tag}`)
        continue
      }
      git(['push', 'origin', '--delete', `refs/tags/${tag}`])
      git(['tag', '-d', tag])
      console.log(`Deleted ${tag}: ${tag.slice(1)} never reached npm.`)
    } catch (error) {
      console.log(`::warning::Could not remove unreleased tag ${tag}: ${error.message}`)
    }
  }
}

main().catch((error) => {
  console.log(`::warning::Skipped unreleased-tag cleanup: ${error.message}`)
})
