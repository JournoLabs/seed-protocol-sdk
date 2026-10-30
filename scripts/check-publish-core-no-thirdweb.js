#!/usr/bin/env node
/**
 * Fail if `@seedprotocol/publish`'s core entry (src/index.ts) reaches `thirdweb` through static
 * imports. thirdweb is an optional peer, so a static import in the core graph breaks every app
 * that doesn't install it. Thirdweb code belongs behind `@seedprotocol/publish/thirdweb`, or in a
 * dynamic `await import()` that runs only on a Thirdweb path. `import type` is erased and allowed.
 *
 * Usage: node scripts/check-publish-core-no-thirdweb.js
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// `import x from 'y'`, `import { x } from 'y'`, `import 'y'`, `export { x } from 'y'`, `export * from 'y'`.
// `import type` / `export type` are left out: TypeScript erases them.
const STATIC_IMPORT = /(?:^|[\n;])\s*(?:import|export)(?!\s+type\s)(?:\s+[^'";]*?\s+from)?\s*['"]([^'"]+)['"]/g

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Static `thirdweb` imports reachable from `entry`, each with the import chain that reaches it
 * (paths relative to `srcDir`). Follows relative and `~/` (= `srcDir`) imports.
 */
export function findThirdwebImports(srcDir, entry) {
  const resolve = (fromFile, spec) => {
    const base = spec.startsWith('~/') ? path.join(srcDir, spec.slice(2)) : path.resolve(path.dirname(fromFile), spec)
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
    return candidates.find(isFile)
  }
  const parent = new Map([[entry, null]])
  const queue = [entry]
  const hits = []
  while (queue.length > 0) {
    const file = queue.shift()
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const [, spec] of src.matchAll(STATIC_IMPORT)) {
      if (/^thirdweb(\/|$)/.test(spec)) {
        hits.push({ file, spec })
        continue
      }
      if (!spec.startsWith('.') && !spec.startsWith('~/')) continue
      const next = resolve(file, spec)
      if (next && !parent.has(next)) {
        parent.set(next, file)
        queue.push(next)
      }
    }
  }
  const chain = (file) => {
    const steps = []
    for (let f = file; f; f = parent.get(f)) steps.unshift(path.relative(srcDir, f))
    return steps
  }
  return { reached: parent.size, imports: hits.map(({ file, spec }) => ({ spec, chain: chain(file) })) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const srcDir = path.join(rootDir, 'packages/publish/src')
  const { reached, imports } = findThirdwebImports(srcDir, path.join(srcDir, 'index.ts'))
  if (imports.length > 0) {
    console.error('[publish-core-no-thirdweb] the core entry statically imports thirdweb:')
    for (const { spec, chain } of imports) console.error(`  '${spec}' in ${chain.join(' -> ')}`)
    console.error('Move the code behind @seedprotocol/publish/thirdweb, or load it with a dynamic import on a Thirdweb path.')
    process.exit(1)
  }
  console.log(`[publish-core-no-thirdweb] OK — ${reached} files reachable from packages/publish/src/index.ts`)
}
