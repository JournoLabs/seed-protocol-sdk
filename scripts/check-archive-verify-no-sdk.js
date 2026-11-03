#!/usr/bin/env node
/**
 * Fail if `@seedprotocol/archive/verify` (src/verify.ts) reaches `@seedprotocol/sdk` through
 * static imports. The SDK is an optional peer of archive: a reader checking a published bag has
 * no SDK, and the verify entry needs none. `import type` is erased and allowed.
 *
 * Usage: node scripts/check-archive-verify-no-sdk.js
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findStaticImports } from './check-publish-core-no-thirdweb.js'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srcDir = path.join(rootDir, 'packages/archive/src')
  const { reached, imports } = findStaticImports(srcDir, path.join(srcDir, 'verify.ts'), (spec) =>
    /^@seedprotocol\/sdk(\/|$)/.test(spec),
  )
  if (imports.length > 0) {
    console.error('[archive-verify-no-sdk] the verify entry statically imports the SDK:')
    for (const { spec, chain } of imports) console.error(`  '${spec}' in ${chain.join(' -> ')}`)
    console.error('Keep SDK reads out of the modules src/verify.ts imports.')
    process.exit(1)
  }
  console.log(`[archive-verify-no-sdk] OK — ${reached} files reachable from packages/archive/src/verify.ts`)
}
