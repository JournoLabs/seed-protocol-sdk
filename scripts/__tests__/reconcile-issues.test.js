import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseRefs, planChanges, releaseFor } from '../reconcile-issues.js'

const issue = (number, status, extra = {}) => ({ number, state: 'OPEN', status, release: null, itemId: `item-${number}`, ...extra })
const ev = (o = {}) => ({ onBranch: false, onLocalMain: false, onOrigin: false, completedOnOrigin: false, releasedIn: null, ...o })
const plan = (issues, evidence) => planChanges(issues, new Map(Object.entries(evidence).map(([k, v]) => [Number(k), v])))

describe('parseRefs', () => {
  it('separates finishing references from the rest', () => {
    assert.deepEqual(parseRefs('feat: x\n\nRefs #3, #4\nCompletes #5\nFixes #6'), { refs: [3, 4, 5, 6], completes: [5, 6] })
  })
})

describe('planChanges', () => {
  it('moves an issue referenced only on an unmerged branch to In progress', () => {
    const { changes } = plan([issue(1, 'Ready')], { 1: ev({ onBranch: true }) })
    assert.deepEqual(changes, [{ issue: 1, itemId: 'item-1', setStatus: 'In progress' }])
  })

  it('moves an issue referenced on local main to In review, even when a branch also has it', () => {
    const { changes } = plan([issue(1, 'Backlog')], { 1: ev({ onBranch: true, onLocalMain: true }) })
    assert.equal(changes[0].setStatus, 'In review')
  })

  it('keeps a completed, pushed but unreleased issue In review', () => {
    const { changes } = plan([issue(1, 'In progress')], { 1: ev({ onLocalMain: true, onOrigin: true, completedOnOrigin: true }) })
    assert.deepEqual(changes, [{ issue: 1, itemId: 'item-1', setStatus: 'In review' }])
  })

  it('marks a completed, released issue Done, sets Release and closes it', () => {
    const { changes } = plan([issue(1, 'In review')], {
      1: ev({ onLocalMain: true, onOrigin: true, completedOnOrigin: true, releasedIn: '0.8.3' }),
    })
    assert.deepEqual(changes, [
      { issue: 1, itemId: 'item-1', setStatus: 'Done', setRelease: '0.8.3', close: 'Released in v0.8.3.' },
    ])
  })

  it('does not finish an issue that was released but never completed', () => {
    const { changes } = plan([issue(1, 'In review')], { 1: ev({ onLocalMain: true, onOrigin: true, releasedIn: '0.8.3' }) })
    assert.deepEqual(changes, [])
  })

  it('makes no change when the board already matches', () => {
    const { changes, reports } = plan([issue(1, 'In review')], { 1: ev({ onLocalMain: true }) })
    assert.deepEqual(changes, [])
    assert.deepEqual(reports, [])
  })

  it('leaves an issue with no commits alone', () => {
    const { changes, reports } = plan([issue(1, 'Backlog'), issue(2, 'Ready')], {})
    assert.deepEqual(changes, [])
    assert.deepEqual(reports, [])
  })

  it('never moves a status back and reports a board that is ahead of the commits', () => {
    const { changes, reports } = plan([issue(1, 'Done')], { 1: ev({ onLocalMain: true }) })
    assert.deepEqual(changes, [])
    assert.match(reports[0], /#1 .*Done.*In review/)
  })

  it('reports a closed issue that later commits reference, and does not reopen it', () => {
    const { changes, reports } = plan([issue(1, 'Done', { state: 'CLOSED' })], { 1: ev({ onBranch: true }) })
    assert.deepEqual(changes, [])
    assert.match(reports[0], /#1 is closed/)
  })

  it('leaves a closed issue whose commits are all in its release alone', () => {
    const { reports } = plan([issue(1, 'Done', { state: 'CLOSED', release: '0.8.3' })], {
      1: ev({ onLocalMain: true, onOrigin: true, completedOnOrigin: true, releasedIn: '0.8.3' }),
    })
    assert.deepEqual(reports, [])
  })

  it('reports an issue with commits that is not on the board', () => {
    const { changes, reports } = plan([issue(1, null, { itemId: null })], { 1: ev({ onBranch: true }) })
    assert.deepEqual(changes, [])
    assert.match(reports[0], /#1 .*not on board 5/)
  })

  it('reports references to numbers that are not issues in the repo', () => {
    const { reports } = plan([], { 99: ev({ onBranch: true }) })
    assert.match(reports[0], /#99 is not an issue/)
  })

  it('sets a missing Release on an issue that is already Done', () => {
    const { changes } = plan([issue(1, 'Done')], {
      1: ev({ onLocalMain: true, onOrigin: true, completedOnOrigin: true, releasedIn: '0.8.3' }),
    })
    assert.deepEqual(changes, [{ issue: 1, itemId: 'item-1', setRelease: '0.8.3', close: 'Released in v0.8.3.' }])
  })
})

describe('releaseFor', () => {
  const published = new Map([
    ['@seedprotocol/sdk', new Set(['0.8.2', '0.8.3'])],
    ['@seedprotocol/mcp', new Set(['0.8.4'])],
  ])

  it('returns the earliest tag containing the commit', () => {
    assert.equal(releaseFor(['v0.8.3', 'v0.8.2'], ['@seedprotocol/sdk'], published), '0.8.2')
  })

  it('skips tags at which a touched package is not on npm', () => {
    assert.equal(releaseFor(['v0.8.3', 'v0.8.4'], ['@seedprotocol/sdk', '@seedprotocol/mcp'], published), null)
    assert.equal(releaseFor(['v0.8.4'], ['@seedprotocol/mcp'], published), '0.8.4')
  })

  it('returns null for a package never published', () => {
    assert.equal(releaseFor(['v0.8.3'], ['@seedprotocol/ipfs'], published), null)
  })

  it('needs only a tag when the commit touches no package', () => {
    assert.equal(releaseFor(['v0.8.3'], [], published), '0.8.3')
    assert.equal(releaseFor([], [], published), null)
  })

  it('compares versions numerically', () => {
    const all = new Map([['p', new Set(['0.10.0', '0.9.0'])]])
    assert.equal(releaseFor(['v0.10.0', 'v0.9.0'], ['p'], all), '0.9.0')
  })
})
