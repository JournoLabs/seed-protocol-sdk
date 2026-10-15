/**
 * Per-package CHANGELOG.md sections, written by `bun run release` (see docs/RELEASING.md).
 *
 * A release section is the package's hand-written `## Unreleased` notes, if any, followed by
 * the commits since the last release that touched the package, grouped by conventional-commit
 * type. test/ci/chore commits are left out: they don't change what the package does.
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
 * Commits in `range` (e.g. `v0.7.2..HEAD`) that touched packages/<dir>, newest first, without merges.
 * @param {string} rootDir
 * @param {string} dir
 * @param {string} range
 */
export function packageCommits(rootDir, dir, range) {
  const out = execFileSync('git', ['log', '--no-merges', '--format=%H%x09%s', range, '--', `packages/${dir}`], {
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
 * Writes the release section into each package's CHANGELOG.md. Returns the files it changed.
 * @param {{ rootDir: string, packages: string[], version: string, date: string, range: string }} options
 */
export function writeReleaseChangelogs({ rootDir, packages, version, date, range }) {
  const changed = []
  for (const dir of packages) {
    const file = join(rootDir, 'packages', dir, 'CHANGELOG.md')
    const before = existsSync(file) ? readFileSync(file, 'utf-8') : ''
    const commitGroups = formatCommitGroups(packageCommits(rootDir, dir, range), dir)
    const after = addReleaseSection(before, { version, date, commitGroups })
    if (after !== before) {
      writeFileSync(file, after)
      changed.push(`packages/${dir}/CHANGELOG.md`)
    }
  }
  return changed
}
