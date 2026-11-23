import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkCommitMessage, suggestIssues } from '../check-commit-message.js'

describe('checkCommitMessage', () => {
  it('accepts an issue reference and returns its number', () => {
    const r = checkCommitMessage('feat(feed): llms.txt\n\nRefs #69\n')
    assert.equal(r.ok, true)
    assert.deepEqual(r.refs, [69])
    assert.deepEqual(r.warnings, [])
  })

  it('collects every referenced number once', () => {
    assert.deepEqual(checkCommitMessage('fix: x (#12)\n\nRefs #12, Completes #40').refs, [12, 40])
  })

  it('rejects a message with no reference', () => {
    const r = checkCommitMessage('fix: tighten the lock\n\nBody text.')
    assert.equal(r.ok, false)
    assert.equal(r.skipped, false)
  })

  it('accepts a Refs: none line anywhere in the body', () => {
    assert.equal(checkCommitMessage('test: deflake\n\nMore.\nrefs: NONE\nTrailer: x').ok, true)
  })

  it('does not accept Refs: with another word', () => {
    assert.equal(checkCommitMessage('test: deflake\n\nRefs: nonexistent').ok, false)
  })

  it('ignores references on comment lines, which git strips', () => {
    const r = checkCommitMessage('fix: x\n# Refs #12\n# Refs: none\n')
    assert.equal(r.ok, false)
  })

  it('ignores everything below the scissors line', () => {
    const r = checkCommitMessage('fix: x\n# ------------------------ >8 ------------------------\ndiff --git a/f b/f\n+Refs #3\n')
    assert.equal(r.ok, false)
  })

  for (const subject of [
    "Merge branch 'main' into feat/x",
    'fixup! feat: x',
    'squash! feat: x',
    'amend! feat: x',
    'chore(release): v0.8.3',
    'chore: release 0.8.3',
    'chore: release 0.8.3 (retry changelog)',
  ]) {
    it(`skips "${subject}" commits`, () => {
      const r = checkCommitMessage(`${subject}\n`)
      assert.equal(r.ok, true)
      assert.equal(r.skipped, true)
    })
  }

  it('accepts a closing keyword but warns about it', () => {
    const r = checkCommitMessage('fix: x\n\nFixes #12')
    assert.equal(r.ok, true)
    assert.equal(r.warnings.length, 1)
    assert.match(r.warnings[0], /Completes #12/)
  })
})

describe('suggestIssues', () => {
  const issues = [
    { number: 70, title: '@seedprotocol/mcp: read-only MCP server over stdio' },
    { number: 69, title: 'Agent-readable published sites' },
    { number: 54, title: 'Show archive cost before publish' },
  ]

  it('ranks the issue whose title shares the most words with the branch first', () => {
    assert.equal(suggestIssues('feat/agent-readable-sites', issues)[0].number, 69)
  })

  it('returns nothing when no words match', () => {
    assert.deepEqual(suggestIssues('fix/opfs-lock', issues), [])
  })

  it('ignores branch type prefixes and short words', () => {
    assert.deepEqual(suggestIssues('feat/a-b', issues), [])
    assert.deepEqual(suggestIssues('refactor/publish-x', issues)[0].number, 54)
  })
})
