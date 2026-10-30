import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { findThirdwebImports } from '../check-publish-core-no-thirdweb.js'

describe('findThirdwebImports', () => {
  let src
  const write = (file, text) => {
    mkdirSync(join(src, file, '..'), { recursive: true })
    writeFileSync(join(src, file), text)
  }

  before(() => {
    src = mkdtempSync(join(tmpdir(), 'core-no-thirdweb-'))
    write('index.ts', "export { a } from './a'\nexport * from './lazy'\nexport type { T } from './typesOnly'\n")
    write('a.ts', "import { b } from '~/helpers/b'\nexport const a = b\n")
    write('helpers/b.ts', "import { defineChain } from 'thirdweb/chains'\nexport const b = defineChain\n")
    write(
      'lazy.ts',
      [
        "import type { Account } from 'thirdweb/wallets'",
        '// import { x } from "thirdweb"',
        "export async function lazy() { const { getContract } = await import('thirdweb'); return getContract }",
      ].join('\n'),
    )
    write('typesOnly.ts', "import { sendTransaction } from 'thirdweb'\nexport type T = typeof sendTransaction\n")
  })
  after(() => rmSync(src, { recursive: true, force: true }))

  it('reports a static import with the chain that reaches it, following ~/ imports', () => {
    const { imports } = findThirdwebImports(src, join(src, 'index.ts'))
    assert.deepEqual(imports, [{ spec: 'thirdweb/chains', chain: ['index.ts', 'a.ts', 'helpers/b.ts'] }])
  })

  it('ignores import type, comments, dynamic imports and modules reached only through export type', () => {
    const { imports, reached } = findThirdwebImports(src, join(src, 'index.ts'))
    assert.ok(!imports.some(({ chain }) => chain.includes('lazy.ts') || chain.includes('typesOnly.ts')))
    assert.equal(reached, 4)
  })
})
