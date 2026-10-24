#!/usr/bin/env node
/**
 * Ratchet on knip's report (unused files, exports, types and dependencies; config in knip.jsonc).
 *
 * Fails when any issue type has more entries than scripts/knip-baseline.json allows, and also
 * when it has fewer, so the baseline drops with the code. After deleting dead code, or after
 * accepting a new finding as a false positive in knip.jsonc, run
 *
 *   node scripts/check-knip.js --update
 *
 * and commit the baseline. The SDK audit found about 6k lines of dead code from superseded
 * designs, one 1,448-line unused file among them, edited by six fix commits.
 *
 * knip loads vite.config.js, which imports @seedprotocol/vite from its dist, so build the
 * packages first (`SKIP_TESTS=1 node scripts/build-packages.js`).
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE_PATH = path.join(rootDir, 'scripts', 'knip-baseline.json')

/**
 * Entries per issue type in a knip JSON report (`--reporter json`), keeping only non-zero types.
 * @param {{ issues: Array<Record<string, unknown>> }} report
 * @returns {Record<string, number>}
 */
export function countIssues(report) {
  const counts = {}
  for (const issue of report.issues) {
    for (const [type, entries] of Object.entries(issue)) {
      if (!Array.isArray(entries) || entries.length === 0) continue
      counts[type] = (counts[type] ?? 0) + entries.length
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Issue types whose count differs from the baseline.
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} baseline
 * @returns {{ over: string[], under: string[] }}
 */
export function compareToBaseline(counts, baseline) {
  const types = new Set([...Object.keys(counts), ...Object.keys(baseline)])
  const over = []
  const under = []
  for (const type of [...types].sort()) {
    const now = counts[type] ?? 0
    const allowed = baseline[type] ?? 0
    if (now > allowed) over.push(type)
    else if (now < allowed) under.push(type)
  }
  return { over, under }
}

/** `file: name` for each entry of `type` in the report. */
function listIssues(report, type) {
  const lines = []
  for (const issue of report.issues) {
    for (const entry of issue[type] ?? []) {
      lines.push(entry.name && entry.name !== issue.file ? `  ${issue.file}: ${entry.name}` : `  ${issue.file}`)
    }
  }
  return lines
}

function runKnip() {
  const result = spawnSync('npx', ['knip', '--reporter', 'json', '--no-exit-code', '--no-progress'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    throw new Error(`knip exited with ${result.status}`)
  }
  // knip prints config-loading errors to stdout ahead of the JSON (e.g. an unbuilt dist)
  const start = result.stdout.indexOf('{"issues"')
  if (start === -1) {
    process.stderr.write(result.stdout + result.stderr)
    throw new Error('knip printed no JSON report')
  }
  if (start > 0) {
    process.stderr.write(result.stdout.slice(0, start))
    throw new Error('knip could not load part of its config; build the packages first')
  }
  return JSON.parse(result.stdout)
}

function main() {
  const report = runKnip()
  const counts = countIssues(report)

  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n')
    console.log(`[check-knip] wrote ${path.relative(rootDir, BASELINE_PATH)}:`, counts)
    return
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const { over, under } = compareToBaseline(counts, baseline)
  for (const type of over) {
    console.error(`[check-knip] ${type}: ${counts[type] ?? 0}, baseline ${baseline[type] ?? 0}`)
    console.error(listIssues(report, type).join('\n'))
  }
  for (const type of under) {
    console.error(`[check-knip] ${type}: ${counts[type] ?? 0}, below baseline ${baseline[type] ?? 0}`)
  }
  if (over.length > 0) {
    console.error(
      '[check-knip] Delete what is unused, or, for a false positive, add it to knip.jsonc with a reason.',
    )
  }
  if (under.length > 0) {
    console.error('[check-knip] Lower the baseline: node scripts/check-knip.js --update')
  }
  if (over.length > 0 || under.length > 0) process.exit(1)
  console.log('[check-knip] at baseline:', counts)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`[check-knip] ${error.message}`)
    process.exit(1)
  }
}
