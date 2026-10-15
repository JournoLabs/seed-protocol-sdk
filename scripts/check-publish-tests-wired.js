#!/usr/bin/env node
/**
 * Fails if a packages/publish test file is not run by anything.
 *
 * publish tests use two runners: bun:test files are listed one by one in the
 * package's `test` script (separate `bun test` runs, because bun's mock.module
 * leaks across files in one run), and a few vitest files are listed in the root
 * vite.config.js. A new file in neither list is silently never run, which is
 * how savePublish.test.ts went unrun.
 *
 * Exits 0 if every test file is listed for the runner it imports; exits 1 and
 * prints each unlisted file otherwise.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(fileURLToPath(new URL('.', import.meta.url)), '..')
const publishDir = path.join(rootDir, 'packages', 'publish')

function* walkTestFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      yield* walkTestFiles(full)
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      yield full
    }
  }
}

const bunScript = JSON.parse(readFileSync(path.join(publishDir, 'package.json'), 'utf8')).scripts.test
const bunListed = new Set(bunScript.match(/\S+\.test\.tsx?/g) ?? [])
const viteConfig = readFileSync(path.join(rootDir, 'vite.config.js'), 'utf8')

let hadViolation = false

for (const file of walkTestFiles(path.join(publishDir, 'src'))) {
  const fromPublish = path.relative(publishDir, file).split(path.sep).join('/')
  const fromRoot = path.relative(rootDir, file).split(path.sep).join('/')
  const source = readFileSync(file, 'utf8')
  if (/from ['"]bun:test['"]/.test(source)) {
    if (!bunListed.has(fromPublish)) {
      console.error(`[check-publish-tests-wired] ${fromRoot} uses bun:test but is not in packages/publish "test"`)
      hadViolation = true
    }
  } else if (!viteConfig.includes(`'${fromRoot}'`)) {
    console.error(`[check-publish-tests-wired] ${fromRoot} is not bun:test and not listed in vite.config.js`)
    hadViolation = true
  }
}

if (hadViolation) {
  process.exit(1)
}
process.exit(0)
