#!/usr/bin/env node
/**
 * Brings board 5 (JournoLabs project 5) in line with what the commits show.
 *
 * Reads commits since COMMITS_SINCE on local branches and origin's branches, the issues they
 * reference (`Refs #N`, and `Completes #N` on the commit that finishes an issue), release tags
 * and npm. For each referenced issue the expected status is:
 *
 *   only on an unmerged branch                                     In progress
 *   on local main or on origin/main                                In review
 *   completed on origin/main, in tag vX.Y.Z, touched packages
 *   published at X.Y.Z                                             Done, Release X.Y.Z, closed
 *
 * Statuses only move forward. Anything else (an issue missing from the board, a closed issue
 * referenced again, a board status ahead of the commits, a reference to a PR or a missing
 * number, a Release option the board lacks) is reported and left alone.
 *
 * Usage: node scripts/reconcile-issues.js [--apply] [--no-fetch]
 * Without --apply it prints the changes it would make. Runs `git fetch origin --tags` first.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARD, REPO, fetchBoardItems } from './check-commit-message.js'

/** Commits before this date predate issue references and are not read. */
// With no time, git reads a date as that day at the current time of day.
const COMMITS_SINCE = '2026-11-19T00:00'

const STATUSES = ['Backlog', 'Ready', 'In progress', 'In review', 'Done']
const rank = (status) => STATUSES.indexOf(status)

const REF = /#(\d+)\b/g
const COMPLETES = /\b(?:completes|fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b:?\s+#(\d+)/gi

export function parseRefs(message) {
  const refs = [...new Set([...message.matchAll(REF)].map((m) => Number(m[1])))]
  const completes = [...new Set([...message.matchAll(COMPLETES)].map((m) => Number(m[1])))]
  return { refs, completes }
}

function expectedStatus(e) {
  if (e.completedOnOrigin && e.releasedIn) return 'Done'
  if (e.onLocalMain || e.onOrigin) return 'In review'
  if (e.onBranch) return 'In progress'
  return null
}

/**
 * @param issues   [{ number, state: 'OPEN'|'CLOSED', status, release, itemId }]
 * @param evidence Map<number, { onBranch, onLocalMain, onOrigin, completedOnOrigin, releasedIn }>
 * @returns {{ changes: { issue, itemId, setStatus?, setRelease?, close? }[], reports: string[] }}
 */
export function planChanges(issues, evidence) {
  const byNumber = new Map(issues.map((i) => [i.number, i]))
  const changes = []
  const reports = []

  for (const [number, e] of [...evidence].sort((a, b) => a[0] - b[0])) {
    const issue = byNumber.get(number)
    if (!issue) {
      reports.push(`#${number} is not an issue in ${REPO} (a pull request, or no such number); commits reference it.`)
      continue
    }
    const expected = expectedStatus(e)
    if (!expected) continue

    if (issue.state === 'CLOSED') {
      if (expected !== 'Done') {
        reports.push(`#${number} is closed, but commits not yet released reference it (${expected}). Not reopened.`)
      }
      continue
    }
    if (!issue.itemId) {
      reports.push(`#${number} has commits (${expected}) but is not on board 5.`)
      continue
    }

    const change = { issue: number, itemId: issue.itemId }
    if (rank(expected) > rank(issue.status)) change.setStatus = expected
    else if (rank(expected) < rank(issue.status)) {
      reports.push(`#${number} is ${issue.status} on the board; the commits show ${expected}. Left as is.`)
    }
    if (expected === 'Done') {
      if (issue.release !== e.releasedIn) change.setRelease = e.releasedIn
      change.close = `Released in v${e.releasedIn}.`
    }
    if (Object.keys(change).length > 2) changes.push(change)
  }
  return { changes, reports }
}

const semver = (v) => v.replace(/^v/, '').split('.').map(Number)
const compareVersions = (a, b) => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/**
 * Earliest version, from the tags containing a commit, at which every package the commit
 * touched is on npm. Null when there is none yet.
 */
export function releaseFor(tagsContaining, packageNames, publishedVersions) {
  const versions = tagsContaining.map((t) => t.replace(/^v/, '')).sort(compareVersions)
  return (
    versions.find((v) => packageNames.every((name) => publishedVersions.get(name)?.has(v))) ?? null
  )
}

// ---- I/O ----

const rootDir = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const isAncestor = (commit, ref) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, ref], { cwd: rootDir, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function readCommits() {
  const out = run('git', ['log', '--branches', '--remotes=origin', `--since=${COMMITS_SINCE}`, '--format=%H%x1f%B%x1e'])
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, message] = r.split('\x1f')
      return { hash, ...parseRefs(message) }
    })
    .filter((c) => c.refs.length > 0)
}

/** npm names of the public workspace packages a commit changed. */
function touchedPackages(hash) {
  const dirs = new Set(
    run('git', ['show', '--name-only', '--format=', hash])
      .split('\n')
      .map((f) => f.match(/^packages\/([^/]+)\//)?.[1])
      .filter(Boolean),
  )
  const names = []
  for (const dir of dirs) {
    const file = path.join(rootDir, 'packages', dir, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (!pkg.private) names.push(pkg.name)
  }
  return names
}

const publishedCache = new Map()
function publishedVersions(names) {
  for (const name of names) {
    if (publishedCache.has(name)) continue
    try {
      const v = JSON.parse(run('npm', ['view', name, 'versions', '--json']))
      publishedCache.set(name, new Set(Array.isArray(v) ? v : [v]))
    } catch {
      publishedCache.set(name, new Set())
    }
  }
  return publishedCache
}

function gatherEvidence(commits) {
  const evidence = new Map()
  for (const c of commits) {
    const onLocalMain = isAncestor(c.hash, 'main')
    const onOrigin = isAncestor(c.hash, 'origin/main')
    let releasedIn = null
    if (onOrigin) {
      const tags = run('git', ['tag', '--contains', c.hash, '--list', 'v*']).split('\n').filter(Boolean)
      const packages = touchedPackages(c.hash)
      releasedIn = releaseFor(tags, packages, publishedVersions(packages))
    }
    for (const n of c.refs) {
      const e = evidence.get(n) ?? { onBranch: false, onLocalMain: false, onOrigin: false, completedOnOrigin: false, released: [] }
      e.onBranch ||= !onLocalMain && !onOrigin
      e.onLocalMain ||= onLocalMain
      e.onOrigin ||= onOrigin
      e.completedOnOrigin ||= onOrigin && c.completes.includes(n)
      if (onLocalMain || onOrigin) e.released.push(releasedIn)
      evidence.set(n, e)
    }
  }
  // An issue is released once every landed commit that references it is.
  for (const e of evidence.values()) {
    e.releasedIn = e.released.length && e.released.every(Boolean) ? e.released.sort(compareVersions).at(-1) : null
    delete e.released
  }
  return evidence
}

function readIssues() {
  const issues = JSON.parse(run('gh', ['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '1000', '--json', 'number,state']))
  const board = new Map(fetchBoardItems().map((i) => [i.number, i]))
  return issues.map((i) => ({
    number: i.number,
    state: i.state,
    status: board.get(i.number)?.status ?? null,
    release: board.get(i.number)?.release ?? null,
    itemId: board.get(i.number)?.itemId ?? null,
  }))
}

function boardFields() {
  const { fields } = JSON.parse(run('gh', ['project', 'field-list', String(BOARD.number), '--owner', BOARD.owner, '--format', 'json']))
  const field = (name) => {
    const f = fields.find((x) => x.name === name)
    return { id: f.id, options: new Map(f.options.map((o) => [o.name, o.id])) }
  }
  return { status: field('Status'), release: field('Release') }
}

function setOption(itemId, field, optionId) {
  run('gh', ['project', 'item-edit', '--id', itemId, '--project-id', BOARD.id, '--field-id', field.id, '--single-select-option-id', optionId])
}

function main() {
  const apply = process.argv.includes('--apply')
  if (!process.argv.includes('--no-fetch')) run('git', ['fetch', 'origin', '--tags', '--quiet'])

  const { changes, reports } = planChanges(readIssues(), gatherEvidence(readCommits()))
  const fields = changes.length ? boardFields() : null

  for (const c of changes) {
    const parts = []
    if (c.setStatus) parts.push(`status → ${c.setStatus}`)
    if (c.setRelease) parts.push(`Release → ${c.setRelease}`)
    if (c.close) parts.push('close')
    if (c.setRelease && !fields.release.options.has(c.setRelease)) {
      reports.push(`#${c.issue}: board 5 has no Release option ${c.setRelease}. Add it on the board, then rerun.`)
      continue
    }
    console.log(`${apply ? '' : '[dry run] '}#${c.issue}: ${parts.join(', ')}`)
    if (!apply) continue
    if (c.setStatus) setOption(c.itemId, fields.status, fields.status.options.get(c.setStatus))
    if (c.setRelease) setOption(c.itemId, fields.release, fields.release.options.get(c.setRelease))
    if (c.close) run('gh', ['issue', 'close', String(c.issue), '--repo', REPO, '--comment', c.close])
  }
  if (changes.length === 0) console.log('Board 5 matches the commits.')
  for (const r of reports) console.log(`needs a decision: ${r}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
