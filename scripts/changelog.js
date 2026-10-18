/**
 * Per-package CHANGELOG.md sections, written by `bun run release` (see docs/RELEASING.md).
 *
 * A release section is the package's hand-written `## Unreleased` notes, if any, followed by
 * the commits since the last release that touched the package, grouped by conventional-commit
 * type. test/ci/chore commits are left out: they don't change what the package does.
 *
 * `bun run release -- --retry` moves a release tag past the release commit; it merges the
 * commits it adds (and any new Unreleased notes) into that version's existing section.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

const HIDDEN_TYPES = new Set(['test', 'tests', 'ci', 'chore', 'build', 'style'])
const GROUPS = [
  ['breaking', 'Breaking'],
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['other', 'Other'],
]
const HEADER = '# Changelog\n\nAll notable changes to this package are documented in this file.\n'

/**
 * `type(scope)!: description` → its parts. Non-conventional subjects are type 'other'.
 * @param {string} subject
 */
export function parseCommitSubject(subject) {
  const match = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject)
  if (!match) return { type: 'other', scope: null, breaking: false, description: subject }
  const [, type, scope, bang, description] = match
  return { type: type.toLowerCase(), scope: scope || null, breaking: !!bang, description }
}

/** Release and version-bump commits ("chore: release 0.7.3", "v0.7.1", "bump workspace packages to 0.5.3"). */
export function isVersionBump(subject) {
  return (
    /^chore(\([^)]*\))?:\s*release\b/i.test(subject) ||
    /^v?\d+\.\d+\.\d+\s*$/.test(subject) ||
    /\bbump\b.*\bto\s+v?\d+\.\d+\.\d+/i.test(subject)
  )
}

/**
 * Markdown for one package's commits, grouped. Empty string when nothing is worth listing.
 * @param {{ sha: string, subject: string }[]} commits newest first, as git log gives them
 * @param {string} packageDir e.g. 'publish'; a scope naming it is dropped as redundant
 */
export function formatCommitGroups(commits, packageDir) {
  const groups = new Map(GROUPS.map(([key]) => [key, []]))
  for (const { sha, subject } of commits) {
    if (isVersionBump(subject)) continue
    const parsed = parseCommitSubject(subject)
    if (!parsed.breaking && HIDDEN_TYPES.has(parsed.type)) continue
    const key = parsed.breaking ? 'breaking' : parsed.type === 'feat' || parsed.type === 'fix' ? parsed.type : 'other'
    const scopes = (parsed.scope ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== packageDir)
    const prefix = scopes.length > 0 ? `${scopes.join(', ')}: ` : ''
    groups.get(key).push(`- ${prefix}${parsed.description} (${sha.slice(0, 8)})`)
  }
  const blocks = []
  for (const [key, title] of GROUPS) {
    const lines = groups.get(key)
    if (lines.length > 0) blocks.push(`#### ${title}\n\n${lines.join('\n')}`)
  }
  return blocks.join('\n\n')
}

/**
 * Splits a CHANGELOG into its header (everything before the first `## `), the body of an
 * `## Unreleased` section (without its heading), and the remaining sections.
 * @param {string} text
 */
export function splitChangelog(text) {
  const firstSection = text.search(/^## /m)
  const header = firstSection === -1 ? text : text.slice(0, firstSection)
  let rest = firstSection === -1 ? '' : text.slice(firstSection)
  let unreleased = ''
  const unreleasedMatch = /^## Unreleased[^\n]*\n/i.exec(rest)
  if (unreleasedMatch) {
    const after = rest.slice(unreleasedMatch[0].length)
    const next = after.search(/^## /m)
    unreleased = (next === -1 ? after : after.slice(0, next)).trim()
    rest = next === -1 ? '' : after.slice(next)
  }
  return { header, unreleased, rest }
}

/**
 * The CHANGELOG text with a new `## version (date)` section on top: the Unreleased notes, then
 * the commit groups. Returns the text unchanged when there is nothing to add.
 * @param {string} text existing CHANGELOG ('' when the package has none)
 * @param {{ version: string, date: string, commitGroups: string }} release
 */
export function addReleaseSection(text, { version, date, commitGroups }) {
  const { header, unreleased, rest } = splitChangelog(text)
  if (!unreleased && !commitGroups) return text
  const parts = [`## ${version} (${date})`]
  if (unreleased) parts.push(unreleased)
  if (commitGroups) parts.push(`### Commits\n\n${commitGroups}`)
  const top = header.trim() ? header.trimEnd() + '\n' : HEADER
  return `${top}\n${parts.join('\n\n')}\n${rest ? `\n${rest.trimEnd()}\n` : ''}`
}

/**
 * `#### Title` blocks of a Commits list → [title, lines] in order. Text before the first
 * heading is kept under the title ''.
 * @param {string} block
 * @returns {[string, string[]][]}
 */
function parseCommitGroups(block) {
  const groups = []
  let current = ['', []]
  for (const line of block.split('\n')) {
    const heading = /^#### (.+?)\s*$/.exec(line)
    if (heading) {
      if (current[0] || current[1].length > 0) groups.push(current)
      current = [heading[1], []]
    } else if (line.trim()) {
      current[1].push(line)
    }
  }
  if (current[0] || current[1].length > 0) groups.push(current)
  return groups
}

/**
 * Two Commits lists merged: `added` lines go on top of their group (they're newer), lines
 * already listed aren't repeated, and groups keep the Breaking/Features/Fixes/Other order.
 * @param {string} existing
 * @param {string} added
 */
export function mergeCommitGroups(existing, added) {
  const merged = new Map(parseCommitGroups(existing))
  for (const [title, lines] of parseCommitGroups(added)) {
    const old = merged.get(title) ?? []
    merged.set(title, [...lines.filter((l) => !old.includes(l)), ...old])
  }
  const order = GROUPS.map(([, title]) => title)
  const rank = (title) => (order.includes(title) ? order.indexOf(title) : order.length)
  const titles = [...merged.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : rank(a) - rank(b)))
  return titles
    .filter((title) => merged.get(title).length > 0)
    .map((title) => (title ? `#### ${title}\n\n${merged.get(title).join('\n')}` : merged.get(title).join('\n')))
    .join('\n\n')
}

/**
 * The CHANGELOG text with more notes and commits in the existing `## version` section, for a
 * retried release: Unreleased notes go after the section's notes, commits into its Commits
 * list. Without a section for the version, adds one as addReleaseSection does.
 * @param {string} text
 * @param {{ version: string, date: string, commitGroups: string }} release
 */
export function extendReleaseSection(text, { version, date, commitGroups }) {
  const { header, unreleased, rest } = splitChangelog(text)
  if (!unreleased && !commitGroups) return text
  const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}(?![\\w.-])[^\\n]*(?:\\n|$)`, 'm').exec(rest)
  if (!heading) return addReleaseSection(text, { version, date, commitGroups })

  const bodyStart = heading.index + heading[0].length
  const nextSection = rest.slice(bodyStart).search(/^## /m)
  const bodyEnd = nextSection === -1 ? rest.length : bodyStart + nextSection
  const body = rest.slice(bodyStart, bodyEnd)

  // The section is notes, then `### Commits`, then (rarely) more ### blocks after it
  let notes = body
  let commits = ''
  let after = ''
  const commitsHeading = /^### Commits[^\n]*(?:\n|$)/m.exec(body)
  if (commitsHeading) {
    notes = body.slice(0, commitsHeading.index)
    const list = body.slice(commitsHeading.index + commitsHeading[0].length)
    const nextBlock = list.search(/^### /m)
    commits = nextBlock === -1 ? list : list.slice(0, nextBlock)
    after = nextBlock === -1 ? '' : list.slice(nextBlock)
  }

  const allNotes = [notes.trim(), unreleased].filter(Boolean).join('\n\n')
  const allCommits = mergeCommitGroups(commits, commitGroups)
  const parts = [heading[0].trimEnd()]
  if (allNotes) parts.push(allNotes)
  if (allCommits) parts.push(`### Commits\n\n${allCommits}`)
  if (after.trim()) parts.push(after.trim())
  const section = parts.join('\n\n') + '\n'

  const before = rest.slice(0, heading.index)
  const following = rest.slice(bodyEnd)
  const top = header.trim() ? header.trimEnd() + '\n' : HEADER
  return `${top}\n${before}${section}${following ? `\n${following.trimEnd()}\n` : ''}`
}

/**
 * Commits in `range` (e.g. `v0.7.2..HEAD`) that touched packages/<dir>, newest first, without merges.
 * Changes to the package's CHANGELOG.md don't count, so changelog edits don't list themselves.
 * @param {string} rootDir
 * @param {string} dir
 * @param {string} range
 */
export function packageCommits(rootDir, dir, range) {
  const out = execFileSync('git', ['log', '--no-merges', '--format=%H%x09%s', range, '--', `packages/${dir}`, `:(exclude)packages/${dir}/CHANGELOG.md`], {
    cwd: rootDir,
    encoding: 'utf-8',
  }).trim()
  if (!out) return []
  return out.split('\n').map((line) => {
    const [sha, ...subject] = line.split('\t')
    return { sha, subject: subject.join('\t') }
  })
}

/**
 * The CHANGELOG.md changes a release makes, without writing them: one entry per package whose
 * file changes, with the commit lines it lists. `extend` (a retry) merges into the existing
 * `## version` section instead of adding a new one.
 * @param {{ rootDir: string, packages: string[], version: string, date: string, range: string, extend?: boolean }} options
 * @returns {{ path: string, file: string, text: string, commitLines: string[], movesUnreleased: boolean }[]}
 */
export function planReleaseChangelogs({ rootDir, packages, version, date, range, extend = false }) {
  const plan = []
  for (const dir of packages) {
    const file = join(rootDir, 'packages', dir, 'CHANGELOG.md')
    const before = existsSync(file) ? readFileSync(file, 'utf-8') : ''
    const commitGroups = formatCommitGroups(packageCommits(rootDir, dir, range), dir)
    const after = (extend ? extendReleaseSection : addReleaseSection)(before, { version, date, commitGroups })
    if (after === before) continue
    plan.push({
      path: `packages/${dir}/CHANGELOG.md`,
      file,
      text: after,
      commitLines: commitGroups.split('\n').filter((l) => l.startsWith('- ')),
      movesUnreleased: !!splitChangelog(before).unreleased,
    })
  }
  return plan
}

/**
 * Writes the release section into each package's CHANGELOG.md. Returns the files it changed.
 * @param {{ rootDir: string, packages: string[], version: string, date: string, range: string, extend?: boolean }} options
 */
export function writeReleaseChangelogs(options) {
  const plan = planReleaseChangelogs(options)
  for (const { file, text } of plan) writeFileSync(file, text)
  return plan.map(({ path }) => path)
}
