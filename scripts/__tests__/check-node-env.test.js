import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkNodeEnv } from '../check-node-env.js'

const ok = () => {}
const abiMismatch = () => {
  throw new Error('was compiled against a different Node.js version using NODE_MODULE_VERSION 141.')
}

describe('checkNodeEnv', () => {
  it('passes a matching Node with Web Locks and a loadable better-sqlite3', () => {
    const result = checkNodeEnv({ version: 'v24.21.0', hasLocks: true, nvmrc: '24\n', loadSqlite: ok })
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.warnings, [])
  })

  it('only warns without navigator.locks', () => {
    const { errors, warnings } = checkNodeEnv({ version: 'v24.3.0', hasLocks: false, nvmrc: '24', loadSqlite: ok })
    assert.deepEqual(errors, [])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /navigator\.locks/)
  })

  it('fails on a native module ABI mismatch', () => {
    const { errors } = checkNodeEnv({ version: 'v24.21.0', hasLocks: true, nvmrc: '24', loadSqlite: abiMismatch })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /NODE_MODULE_VERSION mismatch/)
  })

  it('only warns when the major differs from .nvmrc', () => {
    const result = checkNodeEnv({ version: 'v25.9.0', hasLocks: true, nvmrc: '24', loadSqlite: ok })
    assert.deepEqual(result.errors, [])
    assert.equal(result.warnings.length, 1)
  })

  it('skips the .nvmrc comparison when there is none', () => {
    const { warnings } = checkNodeEnv({ version: 'v25.9.0', hasLocks: true, nvmrc: undefined, loadSqlite: ok })
    assert.deepEqual(warnings, [])
  })
})
