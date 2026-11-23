#!/usr/bin/env node
/**
 * commit-msg hook: every commit names the GitHub issue it belongs to, so GitHub links the two.
 *
 * Passes when the message has `#N` (`Refs #N` for work toward an issue, `Completes #N` on the
 * commit that finishes it) or a `Refs: none` line for internal work. Merge, fixup!/squash!/amend!
 * and release commits (`chore: release X.Y.Z` from scripts/release.js) are skipped. Closing keywords (Fixes #N and the like) pass with a
 * warning: GitHub closes the issue on push, but issues close at release
 * (scripts/reconcile-issues.js does that).
 *
 * Installed through `.githooks/commit-msg` (`git config core.hooksPath .githooks`). On rejection
 * it lists the open Ready and In progress issues on board 5, best match for the branch first.
 * `git commit --no-verify` skips it once.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const BOARD = { owner: 'JournoLabs', number: 5, id: 'PVT_kwDOC2xOfc4BhlA7' }
export const REPO = 'JournoLabs/seed-protocol-sdk'

const SKIP_SUBJECT = /^(Merge |fixup! |squash! |amend! |chore\(release\)|chore: release \d)/
const REF = /#(\d+)\b/g
const REFS_NONE = /^refs:\s*none\s*$/im
const CLOSING = /\b(fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b:?\s+#(\d+)/gi
const SCISSORS = /^# -+ >8 -+$/m

/** Message text as git will store it: no comment lines, nothing below the scissors line. */
function stripComments(message) {
  const cut = message.search(SCISSORS)
  const kept = cut === -1 ? message : message.slice(0, cut)
  return kept
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
}

export function checkCommitMessage(message) {
  const text = stripComments(message)
  const subject = text.trimStart().split('\n', 1)[0]
  if (SKIP_SUBJECT.test(subject)) return { ok: true, skipped: true, refs: [], warnings: [] }

  const refs = [...new Set([...text.matchAll(REF)].map((m) => Number(m[1])))]
  const warnings = [...text.matchAll(CLOSING)].map(
    (m) =>
      `"${m[0]}" closes #${m[2]} when it reaches main on origin. Issues close at release; ` +
      `use "Completes #${m[2]}" on the commit that finishes it.`,
  )
  const ok = refs.length > 0 || REFS_NONE.test(text)
  return { ok, skipped: false, refs, warnings }
}

const BRANCH_TYPES = new Set(['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'build', 'ci'])
const words = (s) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !BRANCH_TYPES.has(w))

export function suggestIssues(branch, issues) {
  const branchWords = new Set(words(branch))
  return issues
    .map((issue) => ({ issue, score: words(issue.title).filter((w) => branchWords.has(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.issue.number - a.issue.number)
    .map((s) => s.issue)
}

/** Board 5 items for this repo's issues: `{ itemId, number, title, state?, status, release }`. */
export function fetchBoardItems({ timeout } = {}) {
  const out = execFileSync(
    'gh',
    ['project', 'item-list', String(BOARD.number), '--owner', BOARD.owner, '--limit', '1000', '--format', 'json'],
    { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
  )
  return JSON.parse(out)
    .items.filter((i) => i.content?.type === 'Issue' && i.content.repository === REPO)
    .map((i) => ({
      itemId: i.id,
      number: i.content.number,
      title: i.content.title,
      status: i.status ?? null,
      release: i.release ?? null,
    }))
}

function currentBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function printOpenWork() {
  let open
  try {
    open = fetchBoardItems({ timeout: 5000 }).filter((i) => i.status === 'Ready' || i.status === 'In progress')
  } catch {
    return
  }
  if (open.length === 0) return
  const branch = currentBranch()
  const suggested = suggestIssues(branch, open)
  const rest = open.filter((i) => !suggested.includes(i)).sort((a, b) => a.number - b.number)
  console.error('\nOpen issues on board 5:')
  for (const i of suggested) console.error(`  #${i.number}  ${i.title}  (${i.status}; matches branch ${branch})`)
  for (const i of rest) console.error(`  #${i.number}  ${i.title}  (${i.status})`)
}

function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: check-commit-message.js <commit-msg-file>')
    process.exit(2)
  }
  const result = checkCommitMessage(readFileSync(file, 'utf8'))
  for (const w of result.warnings) console.error(`commit-msg: warning: ${w}`)
  if (result.ok) return
  console.error(
    'commit-msg: the message names no GitHub issue. Add "Refs #N" (or "Completes #N" on the commit\n' +
      'that finishes the issue), or a "Refs: none" line for internal work with no issue.\n' +
      'Skip once with git commit --no-verify.',
  )
  printOpenWork()
  process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
