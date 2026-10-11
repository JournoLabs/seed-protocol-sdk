#!/usr/bin/env node
/**
 * Cut a release: bump every package, commit, tag vX.Y.Z and push main and the
 * tag together. CI publishes it to `latest`. See docs/RELEASING.md.
 *
 * Usage:
 *   bun run release                 # next patch
 *   bun run release -- 0.8.0        # explicit version
 *   bun run release -- --dry-run    # checks and plan only, changes nothing
 *
 * Before asking for confirmation it checks that:
 * - you're on main with a clean tree, not behind origin/main
 * - the version is plain X.Y.Z, newer than the committed version and npm `latest`,
 *   and not already on npm
 * - the tag doesn't exist locally or on origin
 * - the Release run for the current commit didn't fail (needs `gh`; skip with
 *   --skip-ci-check)
 *
 * Confirming means typing the version. If the push fails, the local commit and
 * tag are undone.
 */

import { readFileSync } from 'fs'
import { createInterface } from 'readline/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { git, nextPatch, PUBLISH_ORDER, releaseVersionProblems } from './release-channel.js'
import { syncVersions } from './sync-versions.js'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_BRANCH = process.env.MAIN_BRANCH || 'main'

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const unknown = [...flags].filter((f) => !['--dry-run', '--skip-ci-check'].includes(f))
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown.join(', ')}`)
  const positional = argv.filter((a) => !a.startsWith('--'))
  if (positional.length > 1) throw new Error(`Expected at most one version; got ${positional.join(' ')}`)
  return { version: positional[0] ?? null, dryRun: flags.has('--dry-run'), skipCiCheck: flags.has('--skip-ci-check') }
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
 * Conclusion of the latest Release run for a commit: success, failure, in_progress, none,
 * or null when gh isn't usable.
 * @returns {string | null}
 */
function releaseRunState(sha) {
  try {
    const out = execFileSync(
      'gh',
      ['run', 'list', '--workflow', 'release.yml', '--commit', sha, '--limit', '1', '--json', 'status,conclusion'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const [run] = JSON.parse(out)
    if (!run) return 'none'
    return run.status === 'completed' ? run.conclusion : run.status
  } catch {
    return null
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
  const target = args.version ?? nextPatch(committed)
  const latest = npmView(['@seedprotocol/sdk', 'dist-tags.latest'])
  if (!latest) warnings.push('Could not read npm `latest` for @seedprotocol/sdk.')
  problems.push(...releaseVersionProblems({ target, committed, npmLatest: latest, published: npmView([`@seedprotocol/sdk@${target}`, 'version']) === target }))

  const tag = `v${target}`
  if (git(['tag', '--list', tag])) problems.push(`Tag ${tag} already exists locally.`)
  if (git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])) problems.push(`Tag ${tag} already exists on origin.`)

  const head = git(['rev-parse', 'HEAD'])
  if (!args.skipCiCheck) {
    const state = releaseRunState(head)
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
    previousTag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD'])
  } catch {
    // No earlier release tag.
  }
  const changes = lines(git(['log', '--oneline', '--no-merges', previousTag ? `${previousTag}..HEAD` : 'HEAD']))

  console.log(`\nRelease ${tag}`)
  console.log(`  version     ${committed} → ${target}  (npm latest: ${latest ?? 'unknown'})`)
  console.log(`  packages    ${PUBLISH_ORDER.length}: ${PUBLISH_ORDER.join(', ')}`)
  console.log(`  pushes      ${ahead} unpushed commit(s) on ${MAIN_BRANCH} + the release commit + ${tag}`)
  console.log(`  changes     ${changes.length} commit(s) since ${previousTag || 'the start'}`)
  for (const line of changes.slice(0, 15)) console.log(`                ${line}`)
  if (changes.length > 15) console.log(`                … and ${changes.length - 15} more`)
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

  syncVersions(target)
  const changed = lines(git(['diff', '--name-only']))
  const unexpected = changed.filter((f) => !f.endsWith('package.json'))
  if (unexpected.length > 0) {
    git(['checkout', '--', '.'])
    throw new Error(`Version sync changed more than package.json files (${unexpected.join(', ')}); reverted.`)
  }

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
