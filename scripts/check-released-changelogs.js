#!/usr/bin/env node
/**
 * Fail when a released `## x.y.z` section of a package CHANGELOG.md differs from its text at the
 * release tag `vx.y.z`. Notes for work that lands after a release go under `## Unreleased`; a
 * branch cut before the release and merged after it can carry its note into the renamed section
 * (that is how 0.8.3's publish and eas sections got lines for features the tag doesn't have).
 *
 * A deliberate correction of a released section (a missing Breaking flag, a wrong name) is listed
 * in `scripts/released-changelog-corrections.json` with its reason; that package and version
 * are then not compared. A version whose tag isn't in the clone (a shallow checkout) is skipped.
 * A section the tag's CHANGELOG didn't have is skipped too: `bun run release -- --retry` and
 * hand-written backfills add sections after the tag.
 *
 * Usage: node scripts/check-released-changelogs.js
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Versions before this are not compared: 0.8.0 to 0.8.2 were corrected in place after their tags
 * (batch 17 and 18 audit fixes, regenerated commit lists) before this check existed.
 */
export const FIRST_CHECKED_VERSION = [0, 8, 3]

/**
 * @param {string} text
 * @returns {Map<string, string>} version -> the section's text, from its heading to the next `## `
 */
export function releasedSections(text) {
  const sections = new Map()
  const re = /^## (\d+\.\d+\.\d+)\b.*$/gm
  const matches = [...text.matchAll(re)]
  for (const [i, match] of matches.entries()) {
    const start = match.index
    const next = text.indexOf('\n## ', start + 1)
    const end = next === -1 ? text.length : next
    sections.set(match[1], text.slice(start, end).replace(/[ \t]+$/gm, '').trimEnd())
  }
  return sections
}

/** @param {string} version */
export function isCheckedVersion(version) {
  const parts = version.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== FIRST_CHECKED_VERSION[i]) return parts[i] > FIRST_CHECKED_VERSION[i]
  }
  return true
}

/**
 * @param {object} args
 * @param {Map<string, string>} args.current sections now
 * @param {(version: string) => Map<string, string> | null} args.atTag sections at `v<version>`, or null without the tag
 * @param {{ package: string, version: string, reason: string }[]} args.corrections
 * @param {string} args.packageDir
 * @returns {string[]} one message per released section that changed since its tag
 */
export function changedReleasedSections({ current, atTag, corrections, packageDir }) {
  const errors = []
  for (const [version, text] of current) {
    if (!isCheckedVersion(version)) continue
    if (corrections.some((c) => c.package === packageDir && c.version === version)) continue
    const tagged = atTag(version)
    if (!tagged) continue
    const before = tagged.get(version)
    if (before === undefined || before === text) continue
    errors.push(`packages/${packageDir}/CHANGELOG.md: \`## ${version}\` differs from its text at tag v${version}`)
  }
  return errors
}

function git(args) {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
}

function hasTag(tag) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])
    return true
  } catch {
    return false
  }
}

function main() {
  const correctionsPath = path.join(rootDir, 'scripts/released-changelog-corrections.json')
  const corrections = JSON.parse(readFileSync(correctionsPath, 'utf8'))
  const errors = []
  const skipped = new Set()
  for (const packageDir of readdirSync(path.join(rootDir, 'packages'))) {
    const file = path.join(rootDir, 'packages', packageDir, 'CHANGELOG.md')
    if (!existsSync(file)) continue
    const cache = new Map()
    const atTag = (version) => {
      if (!cache.has(version)) {
        let sections = null
        if (hasTag(`v${version}`)) {
          try {
            sections = releasedSections(git(['show', `v${version}:packages/${packageDir}/CHANGELOG.md`]))
          } catch {
            sections = new Map()
          }
        } else {
          skipped.add(`v${version}`)
        }
        cache.set(version, sections)
      }
      return cache.get(version)
    }
    errors.push(
      ...changedReleasedSections({
        current: releasedSections(readFileSync(file, 'utf8')),
        atTag,
        corrections,
        packageDir,
      }),
    )
  }
  if (skipped.size > 0) console.log(`[released-changelogs] no tag in this clone, skipped: ${[...skipped].join(', ')}`)
  if (errors.length > 0) {
    for (const message of errors) console.error(`[released-changelogs] ${message}`)
    console.error(
      'Put notes for later work under `## Unreleased`. To correct a released section on purpose, ' +
        'add the package, version and reason to scripts/released-changelog-corrections.json.',
    )
    process.exit(1)
  }
  console.log('[released-changelogs] OK')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
