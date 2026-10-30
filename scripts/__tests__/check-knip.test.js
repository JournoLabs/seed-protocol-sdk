import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compareToBaseline, countIssues } from '../check-knip.js'

describe('countIssues', () => {
  it('sums entries per issue type across files and drops empty types', () => {
    const report = {
      issues: [
        { file: 'a.ts', files: [{ name: 'a.ts' }], exports: [], types: [{ name: 'T' }] },
        { file: 'b.ts', files: [], exports: [{ name: 'x' }, { name: 'y' }], types: [{ name: 'U' }] },
        { file: 'package.json', dependencies: [{ name: 'lodash' }] },
      ],
    }
    assert.deepEqual(countIssues(report), { dependencies: 1, exports: 2, files: 1, types: 2 })
  })
})

describe('compareToBaseline', () => {
  it('reports types above and below the baseline', () => {
    assert.deepEqual(compareToBaseline({ exports: 3, files: 1 }, { exports: 2, types: 1 }), {
      over: ['exports', 'files'],
      under: ['types'],
    })
  })
  it('passes when every count matches', () => {
    assert.deepEqual(compareToBaseline({ exports: 2 }, { exports: 2 }), { over: [], under: [] })
  })
})
