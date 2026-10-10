import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  channelIdForBranch,
  cleanBranchName,
  compareStable,
  findCollidingBranches,
  isValidSemver,
  nextPatch,
  resolveRelease,
  stagingTag,
} from '../release-channel.js'

const SHA = '8b65a15e0c3d2f1a9b8c7d6e5f4a3b2c1d0e9f8a'
const NUMERIC_SHA = '0412345e0c3d2f1a9b8c7d6e5f4a3b2c1d0e9f8a'

describe('cleanBranchName', () => {
  it('lowercases and replaces characters outside [0-9a-z-]', () => {
    assert.equal(cleanBranchName('feature/Foo_bar.baz'), 'feature-foo-bar-baz')
    assert.equal(cleanBranchName('dependabot/npm_and_yarn/x'), 'dependabot-npm-and-yarn-x')
  })
})

describe('channelIdForBranch', () => {
  it('maps the main branch to next', () => {
    assert.equal(channelIdForBranch('main'), 'next')
    assert.equal(channelIdForBranch('trunk', 'trunk'), 'next')
  })

  it('uses the cleaned name for ordinary branches', () => {
    assert.equal(channelIdForBranch('fix/model-property'), 'fix-model-property')
  })

  it('prefixes reserved tags and the staging prefix', () => {
    assert.equal(channelIdForBranch('latest'), 'branch-latest')
    assert.equal(channelIdForBranch('Latest'), 'branch-latest')
    assert.equal(channelIdForBranch('next'), 'branch-next')
    assert.equal(channelIdForBranch('ci-thing'), 'branch-ci-thing')
  })

  it('prefixes names npm could read as a version or range', () => {
    assert.equal(channelIdForBranch('007'), 'branch-007')
    assert.equal(channelIdForBranch('v2'), 'branch-v2')
    assert.equal(channelIdForBranch('1.x'), 'branch-1-x')
    assert.equal(channelIdForBranch('x'), 'branch-x')
    assert.equal(channelIdForBranch('2fa-login'), 'branch-2fa-login')
  })

  it('prefixes repeated leading v before a digit or x', () => {
    assert.equal(channelIdForBranch('vv1'), 'branch-vv1')
    assert.equal(channelIdForBranch('vx'), 'branch-vx')
  })

  it('always yields an id that makes a valid prerelease version', () => {
    for (const branch of ['007', '0', '---', 'a/b/c', 'UPPER', 'v1.2.3', 'x', 'feat_1', '1-2-3']) {
      const id = channelIdForBranch(branch)
      assert.ok(isValidSemver(`0.6.11-${id}.1.g0412345`), `${branch} -> ${id}`)
    }
  })

  it('leaves names that only start with v or x alone', () => {
    assert.equal(channelIdForBranch('vite-upgrade'), 'vite-upgrade')
    assert.equal(channelIdForBranch('xstate'), 'xstate')
  })
})

describe('findCollidingBranches', () => {
  it('finds other branches that clean to the same id', () => {
    const live = ['main', 'feat/x', 'feat-x', 'Feat-X', 'other']
    assert.deepEqual(findCollidingBranches('feat/x', live), ['feat-x', 'Feat-X'])
  })

  it('does not treat main and a branch named next as colliding', () => {
    assert.deepEqual(findCollidingBranches('next', ['main', 'next']), [])
  })

  it('returns nothing when the branch is unique', () => {
    assert.deepEqual(findCollidingBranches('feat/x', ['main', 'feat/x']), [])
  })
})

describe('nextPatch / compareStable', () => {
  it('bumps the patch', () => {
    assert.equal(nextPatch('0.6.10'), '0.6.11')
  })

  it('refuses a committed prerelease', () => {
    assert.throws(() => nextPatch('0.6.11-next.1.gabc1234'), /not plain X\.Y\.Z/)
  })

  it('compares numerically, not lexically', () => {
    assert.ok(compareStable('0.6.10', '0.6.9') > 0)
    assert.ok(compareStable('0.6.9', '0.7.0') < 0)
    assert.equal(compareStable('1.2.3', '1.2.3'), 0)
  })
})

describe('resolveRelease', () => {
  it('publishes a matching tag to latest', () => {
    assert.deepEqual(
      resolveRelease({ ref: 'refs/tags/v0.6.11', sha: SHA, baseVersion: '0.6.11' }),
      { channel: 'release', version: '0.6.11', distTag: 'latest', stagingTag: 'ci-g8b65a15', branch: null },
    )
  })

  it('fails when the tag does not match the committed version', () => {
    assert.throws(
      () => resolveRelease({ ref: 'refs/tags/v0.6.11', sha: SHA, baseVersion: '0.6.10' }),
      /does not match the committed version 0\.6\.10/,
    )
  })

  it('rejects prerelease and malformed tags', () => {
    assert.throws(() => resolveRelease({ ref: 'refs/tags/v0.7.0-rc.1', sha: SHA, baseVersion: '0.7.0' }), /vX\.Y\.Z/)
    assert.throws(() => resolveRelease({ ref: 'refs/tags/0.6.11', sha: SHA, baseVersion: '0.6.11' }), /vX\.Y\.Z/)
  })

  it('builds the main prerelease version', () => {
    const result = resolveRelease({ ref: 'refs/heads/main', sha: SHA, baseVersion: '0.6.10', commitCount: 222 })
    assert.equal(result.version, '0.6.11-next.222.g8b65a15')
    assert.equal(result.distTag, 'next')
    assert.equal(result.channel, 'preview')
    assert.equal(result.branch, 'main')
  })

  it('uses the same id in the version and the tag', () => {
    const result = resolveRelease({ ref: 'refs/heads/007', sha: SHA, baseVersion: '0.6.10', commitCount: 5 })
    assert.equal(result.version, '0.6.11-branch-007.5.g8b65a15')
    assert.equal(result.distTag, 'branch-007')
    assert.ok(isValidSemver(result.version))
  })

  it('stays valid semver when the short SHA is all digits with a leading zero', () => {
    const result = resolveRelease({ ref: 'refs/heads/main', sha: NUMERIC_SHA, baseVersion: '0.6.10', commitCount: 1 })
    assert.equal(result.version, '0.6.11-next.1.g0412345')
    assert.ok(isValidSemver(result.version))
    assert.ok(!isValidSemver('0.6.11-next.1.0412345'))
  })

  it('is deterministic for the same inputs', () => {
    const input = { ref: 'refs/heads/feat/x', sha: SHA, baseVersion: '0.6.10', commitCount: 9 }
    assert.deepEqual(resolveRelease(input), resolveRelease(input))
  })

  it('requires a full SHA and a commit count on branches', () => {
    assert.throws(() => resolveRelease({ ref: 'refs/heads/main', sha: '8b65a15', baseVersion: '0.6.10', commitCount: 1 }), /40-character/)
    assert.throws(() => resolveRelease({ ref: 'refs/heads/main', sha: SHA, baseVersion: '0.6.10' }), /commit count/)
  })

  it('rejects other refs', () => {
    assert.throws(() => resolveRelease({ ref: 'refs/pull/1/merge', sha: SHA, baseVersion: '0.6.10', commitCount: 1 }), /Unsupported ref/)
  })
})

describe('stagingTag', () => {
  it('uses the short SHA with a g prefix', () => {
    assert.equal(stagingTag(SHA), 'ci-g8b65a15')
  })
})
