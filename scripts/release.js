#!/usr/bin/env node
/**
 * Cut a release: bump every package, commit, tag vX.Y.Z and push main and the
 * tag together. CI publishes it to `latest`. See docs/RELEASING.md.
 *
 * Usage:
 *   bun run release                 # next patch
 *   bun run release -- 0.8.0        # explicit version
 *   bun run release -- --dry-run    # checks and plan only, changes nothing
 *   bun run release -- --retry      # re-release the committed version whose tag run failed
 *
 * --retry is for a release that failed before anything published: it moves that
 * version's tag to HEAD (which must contain the old tag's commit, e.g. with fixes
 * on top) and pushes it again, instead of skipping to the next patch. When HEAD adds
 * commits or Unreleased notes to the packages, it first commits them into that version's
 * CHANGELOG sections (only CHANGELOG.md changes) and tags that commit.
 *
 * Before asking for confirmation it checks that:
 * - you're on main with a clean tree, not behind origin/main
 * - the version is plain X.Y.Z, newer than the committed version and npm `latest`,
 *   and not already on npm
 * - the tag doesn't exist locally or on origin
 * - the Release run for the current commit didn't fail (needs `gh`; skip with
 *   --skip-ci-check)
 *
 * Confirming means typing the version. The release commit also adds a section to each
 * package's CHANGELOG.md (scripts/changelog.js). If the push fails, the local commit and
 * tag are undone.
 */

import { readFileSync } from 'fs'
import { createInterface } from 'readline/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import {
  fetchPublishedVersionsByPackage,
  git,
  nextPatch,
  PUBLISH_ORDER,
  releaseVersionProblems,
  remoteTagCommit,
  retryProblems,
} from './release-channel.js'
import { syncVersions } from './sync-versions.js'
import { planReleaseChangelogs, writeReleaseChangelogs } from './changelog.js'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_BRANCH = process.env.MAIN_BRANCH || 'main'

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const unknown = [...flags].filter((f) => !['--dry-run', '--skip-ci-check', '--retry'].includes(f))
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown.join(', ')}`)
  const positional = argv.filter((a) => !a.startsWith('--'))
  if (positional.length > 1) throw new Error(`Expected at most one version; got ${positional.join(' ')}`)
  const retry = flags.has('--retry')
  if (retry && positional.length > 0) throw new Error('--retry re-releases the committed version; leave out the version.')
  return {
    version: positional[0] ?? null,
    dryRun: flags.has('--dry-run'),
    skipCiCheck: flags.has('--skip-ci-check'),
    retry,
  }
}

function committedVersion() {
  return JSON.parse(readFileSync(join(rootDir, 'packages', 'sdk', 'package.json'), 'utf-8')).version
}

/**
 * `npm view`, quietly; null when it fails (404s included).
 * @returns {string | null}
 */
function npmView(args) {
  try {
    const out = execFileSync('npm', ['view', ...args, '--prefer-online'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

/**
 * Conclusion of the latest Release run for a commit (or, with `--branch`, a tag): success,
 * failure, in_progress, none, or null when gh isn't usable.
 * @param {string[]} filter - e.g. ['--commit', sha] or ['--branch', 'v0.7.3']
 * @returns {string | null}
 */
function releaseRunState(filter) {
  try {
    const out = execFileSync(
      'gh',
      ['run', 'list', '--workflow', 'release.yml', ...filter, '--limit', '1', '--json', 'status,conclusion'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const [run] = JSON.parse(out)
    if (!run) return 'none'
    return run.status === 'completed' ? run.conclusion : run.status
  } catch {
    return null
  }
}

function isAncestor(ancestor, commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, commit], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function lines(output) {
  return output ? output.split('\n') : []
}

async function confirm(version) {
  if (!process.stdin.isTTY) {
    throw new Error('Not a terminal; run this interactively to confirm the release.')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`\nType ${version} to release it, anything else to cancel: `)
    return answer.trim() === version
  } finally {
    rl.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const problems = []
  const warnings = []

  git(['fetch', '--quiet', '--tags', 'origin', MAIN_BRANCH])

  const branch = git(['branch', '--show-current'])
  if (branch !== MAIN_BRANCH) problems.push(`On "${branch || '(detached)'}"; releases are cut from ${MAIN_BRANCH}.`)

  if (git(['status', '--porcelain'])) problems.push('The working tree has uncommitted changes.')

  const upstream = `origin/${MAIN_BRANCH}`
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).split(/\s+/).map(Number)
  if (behind > 0) problems.push(`${MAIN_BRANCH} is ${behind} commit(s) behind ${upstream}; pull first.`)

  const committed = committedVersion()
  const target = args.retry ? committed : (args.version ?? nextPatch(committed))
  const latest = npmView(['@seedprotocol/sdk', 'dist-tags.latest'])
  if (!latest) warnings.push('Could not read npm `latest` for @seedprotocol/sdk.')
  const head = git(['rev-parse', 'HEAD'])

  const tag = `v${target}`
  // The tag on origin before a retry moves it, to restore it if the push fails
  let retriedTagCommit = null
  if (args.retry) {
    retriedTagCommit = remoteTagCommit(tag)
    const byPackage = await fetchPublishedVersionsByPackage()
    problems.push(
      ...retryProblems({
        version: target,
        tagCommit: retriedTagCommit,
        tagInHead: !!retriedTagCommit && isAncestor(retriedTagCommit, head),
        publishedPackages: PUBLISH_ORDER.filter((dir) => byPackage.get(dir)?.has(target)),
        tagRunState: releaseRunState(['--branch', tag]),
      }),
    )
  } else {
    problems.push(...releaseVersionProblems({ target, committed, npmLatest: latest, published: npmView([`@seedprotocol/sdk@${target}`, 'version']) === target }))
    if (git(['tag', '--list', tag])) problems.push(`Tag ${tag} already exists locally.`)
    if (git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])) problems.push(`Tag ${tag} already exists on origin.`)
    const committedTag = `v${committed}`
    if (git(['ls-remote', '--tags', 'origin', `refs/tags/${committedTag}`]) && npmView([`@seedprotocol/sdk@${committed}`, 'version']) !== committed) {
      warnings.push(
        `${committedTag} never reached npm. \`bun run release -- --retry\` re-releases ${committed} from HEAD instead of ` +
          `skipping it; otherwise CI deletes ${committedTag} once ${target} is released.`,
      )
    }
  }

  if (!args.skipCiCheck) {
    const state = releaseRunState(['--commit', head])
    if (state === null) warnings.push('Could not check CI (is `gh` installed and logged in?).')
    else if (state === 'none') warnings.push(`No Release run found for ${head.slice(0, 7)} yet.`)
    else if (state !== 'success' && state !== 'in_progress' && state !== 'queued') {
      problems.push(`The Release run for ${head.slice(0, 7)} ended in "${state}"; fix it or pass --skip-ci-check.`)
    } else if (state !== 'success') {
      warnings.push(`The Release run for ${head.slice(0, 7)} is still ${state}; the tag run repeats its tests.`)
    }
  }

  let previousTag = ''
  try {
    // A retried tag is below HEAD already; list changes since the release before it
    const exclude = args.retry ? ['--exclude', tag] : []
    previousTag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', ...exclude, 'HEAD'])
  } catch {
    // No earlier release tag.
  }
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
  const changes = lines(git(['log', '--oneline', '--no-merges', range]))
  const date = new Date().toISOString().slice(0, 10)
  // A retry adds what came after the failed release commit to its sections; a release
  // adds new sections for everything since the last release
  const changelogRange = args.retry ? (retriedTagCommit ? `${retriedTagCommit}..HEAD` : null) : range
  const changelogPlan = changelogRange
    ? planReleaseChangelogs({ rootDir, packages: PUBLISH_ORDER, version: target, date, range: changelogRange, extend: args.retry })
    : []

  console.log(`\n${args.retry ? 'Retry' : 'Release'} ${tag}`)
  if (args.retry) {
    const to = changelogPlan.length > 0 ? 'a changelog commit on HEAD' : `${head.slice(0, 7)} (HEAD)`
    console.log(`  version     ${target}, already committed  (npm latest: ${latest ?? 'unknown'})`)
    console.log(`  tag         moves ${retriedTagCommit ? retriedTagCommit.slice(0, 7) : '?'} → ${to}`)
  } else {
    console.log(`  version     ${committed} → ${target}  (npm latest: ${latest ?? 'unknown'})`)
  }
  console.log(`  packages    ${PUBLISH_ORDER.length}: ${PUBLISH_ORDER.join(', ')}`)
  const newCommit = !args.retry ? ' + the release commit' : changelogPlan.length > 0 ? ' + the changelog commit' : ''
  console.log(`  pushes      ${ahead} unpushed commit(s) on ${MAIN_BRANCH}${newCommit} + ${tag}`)
  console.log(`  changes     ${changes.length} commit(s) since ${previousTag || 'the start'}`)
  for (const line of changes.slice(0, 15)) console.log(`                ${line}`)
  if (changes.length > 15) console.log(`                … and ${changes.length - 15} more`)
  if (args.retry) {
    // Everything the retry adds, since it lands in a commit CI hasn't seen
    if (changelogPlan.length === 0) console.log(`  changelogs  nothing to add to ${target}; tags HEAD as it is`)
    else console.log(`  changelogs  add to the ${target} sections (commits since ${retriedTagCommit.slice(0, 7)}):`)
    for (const { path, commitLines, movesUnreleased } of changelogPlan) {
      console.log(`                ${path}${movesUnreleased ? ' (+ its Unreleased notes)' : ''}`)
      for (const line of commitLines) console.log(`                  ${line}`)
    }
  } else {
    const summary = changelogPlan
      .filter(({ commitLines }) => commitLines.length > 0)
      .map(({ path, commitLines }) => `${path.split('/')[1]} (${commitLines.length})`)
      .join(', ')
    console.log(`  changelogs  ${summary || 'no listable commits'}; Unreleased notes move into the new section`)
  }
  if (!args.retry) {
    // A feature or a breaking change needs prose for users, not only its commit line
    for (const { path, notableLines, movesUnreleased } of changelogPlan) {
      if (movesUnreleased || notableLines.length === 0) continue
      warnings.push(
        `${path.split('/')[1]} has ${notableLines.length} feat or breaking commit(s) and no Unreleased notes in ${path}: ${notableLines[0].slice(2)}`,
      )
    }
  }
  for (const w of warnings) console.log(`  ⚠️  ${w}`)

  if (problems.length > 0) {
    console.error('\nCan’t release:')
    for (const p of problems) console.error(`  ✖ ${p}`)
    process.exit(1)
  }

  if (args.dryRun) {
    console.log('\nDry run: nothing changed.')
    return
  }

  if (!(await confirm(target))) {
    console.log('Cancelled; nothing changed.')
    return
  }

  if (args.retry) {
    // The commits after the failed release commit belong to this version: the next release's
    // changelog starts at the moved tag. Only CHANGELOG.md files change, and the tag run
    // repeats the tests on the tagged commit.
    const changelogs = writeReleaseChangelogs({ rootDir, packages: PUBLISH_ORDER, version: target, date, range: changelogRange, extend: true })
    if (changelogs.length > 0) {
      git(['add', '--', ...changelogs])
      git(['commit', '--quiet', '-m', `chore: release ${target} (retry changelog)`])
      console.log(`\nChangelogs: ${changelogs.join(', ')}`)
    }
    const tagged = git(['rev-parse', 'HEAD'])
    git(['tag', '-f', '-a', tag, '-m', `Release ${target}`, tagged])
    try {
      // Both or neither, as for a new release; + replaces the failed tag on origin.
      execFileSync('git', ['push', '--atomic', 'origin', MAIN_BRANCH, `+refs/tags/${tag}`], { stdio: 'inherit' })
    } catch {
      git(['fetch', '--quiet', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`])
      git(['reset', '--hard', '--quiet', head])
      const undone = changelogs.length > 0 ? 'removed the changelog commit, and ' : ''
      throw new Error(`Push failed; ${undone}${tag} is back where origin has it (${retriedTagCommit.slice(0, 7)}).`)
    }
    console.log(`\n✅ Moved ${tag} to ${tagged.slice(0, 7)} and pushed it. CI publishes it to npm \`latest\` once tests pass.`)
    console.log(`   Runs: gh run list --workflow release.yml --branch ${tag}`)
    return
  }

  syncVersions(target)
  const changed = lines(git(['diff', '--name-only']))
  const unexpected = changed.filter((f) => !f.endsWith('package.json'))
  if (unexpected.length > 0) {
    git(['checkout', '--', '.'])
    throw new Error(`Version sync changed more than package.json files (${unexpected.join(', ')}); reverted.`)
  }

  const changelogs = writeReleaseChangelogs({ rootDir, packages: PUBLISH_ORDER, version: target, date, range })
  if (changelogs.length > 0) git(['add', '--', ...changelogs])
  console.log(`\nChangelogs: ${changelogs.length > 0 ? changelogs.join(', ') : 'none changed'}`)

  git(['commit', '--quiet', '-am', `chore: release ${target}`])
  git(['tag', '-a', tag, '-m', `Release ${target}`])
  try {
    // Both or neither, so the tag never points at a commit main doesn't have.
    execFileSync('git', ['push', '--atomic', 'origin', MAIN_BRANCH, tag], { stdio: 'inherit' })
  } catch {
    git(['tag', '-d', tag])
    git(['reset', '--hard', '--quiet', head])
    throw new Error('Push failed; removed the local release commit and tag.')
  }

  console.log(`\n✅ Pushed ${tag}. CI publishes it to npm \`latest\` once tests pass.`)
  console.log(`   Runs: gh run list --workflow release.yml --branch ${tag}`)
}

main().catch((error) => {
  console.error(`[release] ${error.message}`)
  process.exit(1)
})
