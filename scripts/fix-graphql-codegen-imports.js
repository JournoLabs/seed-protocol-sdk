/**
 * graphql-codegen client preset emits `import { Incremental }` in fragment-masking.ts,
 * but Incremental is a type-only export from graphql.ts. Vite/rolldown fail on the
 * value import; use `import type` instead.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const files = [
  'packages/eas/src/graphql/gql/fragment-masking.ts',
  'packages/arweave/src/graphql/gql/fragment-masking.ts',
]

for (const rel of files) {
  const filePath = path.join(root, rel)
  if (!fs.existsSync(filePath)) continue

  const source = fs.readFileSync(filePath, 'utf8')
  const fixed = source.replace(
    /import \{ Incremental \} from '\.\/graphql';/,
    "import type { Incremental } from './graphql';",
  )

  if (fixed !== source) {
    fs.writeFileSync(filePath, fixed)
    console.log(`[fix-graphql-codegen-imports] fixed ${rel}`)
  }
}
