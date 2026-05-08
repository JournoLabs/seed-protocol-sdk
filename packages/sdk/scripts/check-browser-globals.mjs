#!/usr/bin/env node
/**
 * Scans a built JS output directory for bare Node.js globals that will throw
 * ReferenceError in the browser at runtime.
 *
 * Usage:
 *   node packages/sdk/scripts/check-browser-globals.mjs <dir>
 *   node packages/sdk/scripts/check-browser-globals.mjs ../permapress/apps/web/dist/assets
 *
 * Exit code 0 = clean, 1 = issues found.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// Each entry: the typeof-guard regex that makes a reference safe.
const DANGEROUS_GLOBALS = {
  global:     /\btypeof\s+global\b/,
  process:    /\btypeof\s+process\b/,
  Buffer:     /\btypeof\s+Buffer\b/,
  __dirname:  /\btypeof\s+__dirname\b/,
  __filename: /\btypeof\s+__filename\b/,
}

// Minified typeof-undefined checks seen in bundled output.
// After string-stripping, the quoted content is blanked to spaces, so we
// cannot require 'u' or 'undefined' — just match the typeof + comparison.
// e.g. `typeof Buffer<'u'` → stripped to `typeof Buffer<' '`
const MINIFIED_TYPEOF_UNDEFINED = /\btypeof\s+\w+\s*[<>!]=?/

// If the statement window contains one of these, the surrounding code is
// Node.js-only (an else-branch of a browser-presence check) — skip the hit.
// After stripping, quoted content is blanked, so match typeof alone.
const NODE_ONLY_GUARDS = [
  /\btypeof\s+document\b/,  // typeof document (any comparison → browser detection)
  /\btypeof\s+window\b/,    // typeof window
]

/**
 * Walk the source character-by-character, blanking out string and comment
 * content so identifier searches don't false-positive on string/comment text.
 * Handles nested template literals correctly (simple regex cannot).
 * Positions are preserved (blanked chars → spaces) so hit offsets stay valid.
 *
 * Also strips regex literals heuristically: a `/pattern/flags` that follows
 * an operator, keyword, or opening bracket is treated as a regex.
 */
function stripStringsAndComments(code) {
  const out = Array.from(code)
  const len = code.length
  let i = 0

  const blank = (start, end) => {
    for (let k = start; k < end; k++) out[k] = ' '
  }

  // Tokens after which a `/` starts a regex (not a division operator).
  // We only need "good enough" — this handles the common cases.
  const REGEX_STARTERS = /(?:^|[=({[!&|?:,;~+\-*%^<>])\s*$/

  while (i < len) {
    const ch = code[i]

    // Block comment /* ... */
    if (ch === '/' && code[i + 1] === '*') {
      const start = i; i += 2
      while (i < len && !(code[i - 1] === '*' && code[i] === '/')) i++
      i++
      blank(start, i)
      continue
    }

    // Line comment // ...
    if (ch === '/' && code[i + 1] === '/') {
      const start = i
      while (i < len && code[i] !== '\n') i++
      blank(start, i)
      continue
    }

    // Regex literal (heuristic)
    if (ch === '/') {
      const prev = out.slice(0, i).join('').trimEnd()
      if (REGEX_STARTERS.test(prev)) {
        const start = i; i++
        while (i < len && code[i] !== '/' && code[i] !== '\n') {
          if (code[i] === '\\') i++
          i++
        }
        i++ // closing /
        while (i < len && /[gimsuy]/.test(code[i])) i++ // flags
        blank(start + 1, i)
        continue
      }
    }

    // Template literal — depth-counted to handle ${...} nesting
    if (ch === '`') {
      const start = i; i++
      let depth = 0
      while (i < len) {
        if (code[i] === '\\') { i += 2; continue }
        if (code[i] === '$' && code[i + 1] === '{') { depth++; i += 2; continue }
        if (code[i] === '}' && depth > 0) { depth--; i++; continue }
        if (code[i] === '`' && depth === 0) { i++; break }
        i++
      }
      blank(start + 1, i - 1) // keep delimiters, blank interior
      continue
    }

    // Double-quoted string
    if (ch === '"') {
      const start = i; i++
      while (i < len && code[i] !== '"') { if (code[i] === '\\') i++; i++ }
      i++
      blank(start + 1, i - 1)
      continue
    }

    // Single-quoted string
    if (ch === "'") {
      const start = i; i++
      while (i < len && code[i] !== "'") { if (code[i] === '\\') i++; i++ }
      i++
      blank(start + 1, i - 1)
      continue
    }

    i++
  }

  return out.join('')
}

function scanFile(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  const stripped = stripStringsAndComments(raw)
  const hits = []

  for (const [name, typeofGuard] of Object.entries(DANGEROUS_GLOBALS)) {
    const re = new RegExp(`(?<![.\\w$])\\b${name}\\b(?!This)(?![\\w$])`, 'g')
    let m
    while ((m = re.exec(stripped)) !== null) {
      const offset = m.index

      // ── Skip: this IS the argument to typeof ──────────────────────────────
      // e.g. `typeof process`, `typeof Buffer`
      const immediate = stripped.slice(Math.max(0, offset - 10), offset)
      if (/\btypeof\s+$/.test(immediate)) continue

      // ── Skip: `:global` CSS selector ──────────────────────────────────────
      if (name === 'global' && stripped[offset - 1] === ':') continue

      // ── Skip: method/function definition ──────────────────────────────────
      // Pattern: `}process(` or whitespace-then-`process(` in a class body.
      // The globals are never callable as bare functions, so `name(` is always
      // a method/function name, not the global being called.
      const charAfter = stripped[offset + name.length]
      const charBefore = stripped[offset - 1] ?? ''
      if (charAfter === '(' && /[}\s,]/.test(charBefore)) continue

      // ── Build lookback window to the start of the current statement ────────
      // Use only `;` as a boundary (not `{`) so typeof guards before a block
      // body are still visible. e.g. `if(typeof Buffer<'u'){Buffer.from(x)}`
      // — the `{` would cut off the guard if used as a boundary.
      const stmtStart = Math.max(
        stripped.lastIndexOf(';', offset - 1),
        offset - 600,
        0,
      ) + 1
      const before = stripped.slice(stmtStart, offset)

      // ── Skip: explicit typeof guard in the same statement ─────────────────
      if (typeofGuard.test(before)) continue

      // ── Skip: minified typeof-undefined patterns ───────────────────────────
      // e.g. `typeof Buffer<'u'` or `n=typeof Buffer=='u'`
      if (MINIFIED_TYPEOF_UNDEFINED.test(before)) continue

      // ── Skip: Node.js-only branch (else of browser detection) ─────────────
      if (NODE_ONLY_GUARDS.some((g) => g.test(before))) continue

      const linesBefore = raw.slice(0, offset).split('\n')
      const line = linesBefore.length
      const col = linesBefore[linesBefore.length - 1].length
      const rawLine = raw.split('\n')[line - 1] ?? ''
      const context = rawLine.slice(Math.max(0, col - 40), col + name.length + 40).trim()

      hits.push({ name, line, col, context })
    }
  }

  return hits
}

function walkDir(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walkDir(full))
    } else if (extname(entry) === '.js') {
      files.push(full)
    }
  }
  return files
}

const targetDir = process.argv[2]
if (!targetDir) {
  console.error('Usage: check-browser-globals.mjs <built-js-directory>')
  process.exit(1)
}

// Files/dirs that are Node.js-only — skip them when auditing browser output.
// Adjust this list to match your build's Node.js-only chunks.
const NODE_ONLY_PATTERNS = [
  /\/cjs\//,            // CommonJS build
  /\/vite\.(js|cjs)$/,  // Vite plugin (runs in Node, not browser)
  /\/node\.(js|cjs)$/,  // Node.js entry
  /PathResolver/,       // Node.js path resolution helper
]

const jsFiles = walkDir(targetDir).filter(
  (f) => !NODE_ONLY_PATTERNS.some((re) => re.test(f))
)
let totalHits = 0

for (const file of jsFiles) {
  const hits = scanFile(file)
  if (hits.length === 0) continue
  console.log(`\n${file}`)
  for (const h of hits) {
    console.log(`  line ${h.line}, col ${h.col}: \`${h.name}\``)
    console.log(`    ${h.context}`)
  }
  totalHits += hits.length
}

if (totalHits === 0) {
  console.log('✓ No bare Node.js globals found.')
  process.exit(0)
} else {
  console.log(`\n⚠️  ${totalHits} bare Node.js global reference(s) found — these will throw ReferenceError in the browser.`)
  process.exit(1)
}
