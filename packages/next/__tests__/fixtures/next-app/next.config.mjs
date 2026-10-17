import path from 'node:path'
import { withSeed } from '@seedprotocol/next'

// Workspace packages are symlinks into packages/, so Turbopack's root has to be the repo.
const repoRoot = path.resolve(import.meta.dirname, '../../../../..')

export default withSeed({
  distDir: process.env.SEED_NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
})
