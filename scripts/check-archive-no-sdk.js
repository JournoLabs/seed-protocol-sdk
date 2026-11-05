#!/usr/bin/env node
/**
 * Fail if an SDK-free entry of `@seedprotocol/archive` (the main entry, `/verify` and `/node`)
 * reaches `@seedprotocol/sdk` through static imports. The SDK is an optional peer of archive:
 * only `/seed` (exportArchive, verifyArchiveAgainstChain) reads Seed rows (ADR 0031). `import type`
 * is erased and allowed.
 *
 * Usage: node scripts/check-archive-no-sdk.js
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findStaticImports } from './check-publish-core-no-thirdweb.js'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const ENTRIES = ['index.ts', 'verify.ts', 'node/index.ts']

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srcDir = path.join(rootDir, 'packages/archive/src')
  let failed = false
  for (const entry of ENTRIES) {
    const { reached, imports } = findStaticImports(srcDir, path.join(srcDir, entry), (spec) =>
      /^@seedprotocol\/sdk(\/|$)/.test(spec),
    )
    if (imports.length > 0) {
      failed = true
      console.error(`[archive-no-sdk] src/${entry} statically imports the SDK:`)
      for (const { spec, chain } of imports) console.error(`  '${spec}' in ${chain.join(' -> ')}`)
      continue
    }
    console.log(`[archive-no-sdk] OK — ${reached} files reachable from packages/archive/src/${entry}`)
  }
  if (failed) {
    console.error('Keep SDK reads in src/seed/, which only the /seed entry exports.')
    process.exit(1)
  }
}
