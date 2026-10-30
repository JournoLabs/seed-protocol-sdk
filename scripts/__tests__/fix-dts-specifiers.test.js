import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fix-dts-specifiers.js')

function makeDist(files) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-dts-'))
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dist, name)), { recursive: true })
    fs.writeFileSync(path.join(dist, name), content)
  }
  return dist
}

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
const read = (dist, name) => fs.readFileSync(path.join(dist, name), 'utf8')

describe('fix-dts-specifiers', () => {
  it('adds .js to files and /index.js to directories', () => {
    const dist = makeDist({
      'index.d.ts': [
        "export * from './client'",
        "export { a } from './helpers'",
        "export type B = import('./helpers').B",
        "export { c } from './already.js'",
        "export { d } from 'some-package/sub'",
      ].join('\n'),
      'client.d.ts': 'export declare const client: number',
      'helpers/index.d.ts': 'export declare const a: number; export type B = string',
      'already.d.ts': 'export declare const c: number',
    })
    const result = run(dist)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      read(dist, 'index.d.ts'),
      [
        "export * from './client.js'",
        "export { a } from './helpers/index.js'",
        "export type B = import('./helpers/index.js').B",
        "export { c } from './already.js'",
        "export { d } from 'some-package/sub'",
      ].join('\n'),
    )
  })

  it('rewrites an alias relative to the dist root', () => {
    const dist = makeDist({
      'services/a/index.d.ts': "import type { S } from '~/helpers/signer'\nexport type T = S",
      'helpers/signer.d.ts': 'export type S = string',
    })
    const result = run(dist, '--alias', '~/')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(read(dist, 'services/a/index.d.ts'), "import type { S } from '../../helpers/signer.js'\nexport type T = S")
  })

  it('fails on a specifier with no declaration file', () => {
    const dist = makeDist({ 'index.d.ts': "export * from './gone'" })
    const result = run(dist)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /index\.d\.ts: '\.\/gone'/)
  })
})
