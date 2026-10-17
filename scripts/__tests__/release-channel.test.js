import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import {
  channelIdForBranch,
  cleanBranchName,
  compareStable,
  decideLatest,
  fetchDistTags,
  findCollidingBranches,
  isValidSemver,
  nextPatch,
  previousReleasedTag,
  AWAITING_FIRST_PUBLISH,
  PUBLISH_ORDER,
  releaseVersionProblems,
  retryProblems,
  unreleasedTags,
  resolveRelease,
  retryUntil,
  stagingTag,
  stagingTagsToRemove,
  tagCommitFromLsRemote,
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

describe('releaseVersionProblems', () => {
  it('accepts a version newer than the committed one and npm latest', () => {
    assert.deepEqual(releaseVersionProblems({ target: '0.7.3', committed: '0.7.2', npmLatest: '0.7.2' }), [])
    assert.deepEqual(releaseVersionProblems({ target: '0.8.0', committed: '0.7.2', npmLatest: null }), [])
  })

  it('rejects prerelease and malformed versions', () => {
    assert.match(releaseVersionProblems({ target: '0.7.3-beta.1', committed: '0.7.2' })[0], /plain X\.Y\.Z/)
    assert.match(releaseVersionProblems({ target: 'v0.7.3', committed: '0.7.2' })[0], /plain X\.Y\.Z/)
  })

  it('rejects versions that are not newer', () => {
    assert.match(releaseVersionProblems({ target: '0.7.2', committed: '0.7.2' })[0], /committed version/)
    assert.match(releaseVersionProblems({ target: '0.7.3', committed: '0.7.2', npmLatest: '0.7.3' })[0], /npm `latest`/)
  })

  it('rejects versions already on npm', () => {
    assert.match(releaseVersionProblems({ target: '0.7.3', committed: '0.7.2', published: true })[0], /already on npm/)
  })
})

describe('tagCommitFromLsRemote', () => {
  const OTHER = '1111111111111111111111111111111111111111'

  it('returns the commit of a lightweight tag', () => {
    assert.equal(tagCommitFromLsRemote(`${SHA}\trefs/tags/v0.7.2\n`, 'v0.7.2'), SHA)
  })

  it('peels an annotated tag to its commit', () => {
    const output = `${OTHER}\trefs/tags/v0.7.2\n${SHA}\trefs/tags/v0.7.2^{}\n`
    assert.equal(tagCommitFromLsRemote(output, 'v0.7.2'), SHA)
  })

  it('returns null when the tag is missing', () => {
    assert.equal(tagCommitFromLsRemote('', 'v0.7.2'), null)
    assert.equal(tagCommitFromLsRemote(`${SHA}\trefs/tags/v0.7.20\n`, 'v0.7.2'), null)
  })
})

describe('unreleasedTags', () => {
  const tags = ['v0.7.1', 'v0.7.2', 'v0.7.3', 'v0.7.4', 'v0.7.5', 'v1.0.0-rc.1', 'other']
  const publishedVersions = new Set(['0.7.1', '0.7.2', '0.7.4'])

  it('lists older tags whose version is on npm for no package', () => {
    assert.deepEqual(unreleasedTags({ tags, released: '0.7.5', publishedVersions }), ['v0.7.3'])
  })

  it('never lists the released tag or newer ones', () => {
    assert.deepEqual(unreleasedTags({ tags, released: '0.7.3', publishedVersions }), [])
  })

  it('sorts by version, not by name', () => {
    assert.deepEqual(
      unreleasedTags({ tags: ['v0.10.0', 'v0.9.0'], released: '0.11.0', publishedVersions: new Set() }),
      ['v0.9.0', 'v0.10.0'],
    )
  })
})

describe('previousReleasedTag', () => {
  it('skips tags that never reached npm', () => {
    const tags = ['v0.7.1', 'v0.7.2', 'v0.7.3']
    assert.equal(previousReleasedTag({ tags, released: '0.7.4', publishedVersions: new Set(['0.7.1', '0.7.2']) }), 'v0.7.2')
  })

  it('is null for the first release', () => {
    assert.equal(previousReleasedTag({ tags: ['v0.1.0'], released: '0.1.0', publishedVersions: new Set() }), null)
  })
})

describe('retryProblems', () => {
  const ok = {
    version: '0.7.3',
    tagCommit: SHA,
    tagInHead: true,
    publishedPackages: [],
    tagRunState: 'failure',
  }

  it('allows a failed tag nothing was published from', () => {
    assert.deepEqual(retryProblems(ok), [])
  })

  it('needs the tag on origin', () => {
    assert.match(retryProblems({ ...ok, tagCommit: null }).join(), /no v0\.7\.3 on origin/)
  })

  it('refuses a partly published version and points at re-running', () => {
    assert.match(retryProblems({ ...ok, publishedPackages: ['eas', 'arweave'] }).join(), /Re-run v0\.7\.3's failed Release run/)
  })

  it('refuses a fully published version', () => {
    assert.match(retryProblems({ ...ok, publishedPackages: [...PUBLISH_ORDER] }).join(), /nothing to retry/)
  })

  it('needs HEAD to contain the tag', () => {
    assert.match(retryProblems({ ...ok, tagInHead: false }).join(), /doesn't contain/)
  })

  it('waits for a running tag run and refuses a successful one', () => {
    assert.match(retryProblems({ ...ok, tagRunState: 'in_progress' }).join(), /still in_progress/)
    assert.match(retryProblems({ ...ok, tagRunState: 'success' }).join(), /succeeded/)
  })
})

describe('decideLatest', () => {
  it('moves latest forward or onto the same version', () => {
    assert.equal(decideLatest('0.7.5', undefined).move, true)
    assert.equal(decideLatest('0.7.5', '0.7.4').move, true)
    assert.equal(decideLatest('0.7.5', '0.7.5').move, true)
  })

  it('never moves latest back', () => {
    assert.deepEqual(decideLatest('0.7.4', '0.7.5'), { move: false, reason: 'latest is already newer (0.7.5)' })
  })
})

describe('stagingTagsToRemove', () => {
  const version = '0.7.5-next.850.g9ab585b'

  it("names this run's staging tag even when the read doesn't show it yet", () => {
    assert.deepEqual(stagingTagsToRemove({ tags: { next: '0.7.4-next.793.g6dd83dd' }, version, stagingTag: 'ci-g9ab585b' }), [
      'ci-g9ab585b',
    ])
  })

  it('adds other staging tags on this version, once each, and leaves the rest', () => {
    const tags = {
      next: version,
      'ci-g9ab585b': version,
      'ci-gaaaaaaa': version,
      'ci-g6dd83dd': '0.7.4-next.793.g6dd83dd',
    }
    assert.deepEqual(stagingTagsToRemove({ tags, version, stagingTag: 'ci-g9ab585b' }), ['ci-g9ab585b', 'ci-gaaaaaaa'])
  })

  it('works without a staging tag in the environment', () => {
    assert.deepEqual(stagingTagsToRemove({ tags: { 'ci-g9ab585b': version }, version }), ['ci-g9ab585b'])
  })
})

describe('fetchDistTags', () => {
  it('reads the dist-tags endpoint uncached and drops _etag', async () => {
    let request
    const fakeFetch = async (url, init) => {
      request = { url, init }
      return { ok: true, status: 200, json: async () => ({ latest: '0.7.4', _etag: '"abc"' }) }
    }
    assert.deepEqual(await fetchDistTags('@seedprotocol/publish', fakeFetch), { latest: '0.7.4' })
    assert.equal(request.url, 'https://registry.npmjs.org/-/package/@seedprotocol%2fpublish/dist-tags')
    assert.equal(request.init.cache, 'no-store')
  })

  it('throws on an error response instead of reporting no tags', async () => {
    const fakeFetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
    await assert.rejects(fetchDistTags('@seedprotocol/sdk', fakeFetch), /returned 503/)
  })
})

describe('retryUntil', () => {
  /** A clock that only moves when the code under test sleeps. */
  function fakeClock() {
    let time = 0
    return { now: () => time, sleep: async (ms) => void (time += ms) }
  }

  it('returns the first success', async () => {
    const clock = fakeClock()
    const retries = []
    const result = await retryUntil(
      (attempt) => {
        if (attempt < 3) throw new Error(`no ${attempt}`)
        return 'done'
      },
      { deadline: 60_000, intervalMs: 15_000, onRetry: (e, attempt) => retries.push(attempt), ...clock },
    )
    assert.equal(result, 'done')
    assert.deepEqual(retries, [1, 2])
    assert.equal(clock.now(), 30_000)
  })

  it('rethrows the last error once another wait would pass the deadline', async () => {
    const clock = fakeClock()
    let attempts = 0
    await assert.rejects(
      retryUntil(
        () => {
          attempts++
          throw new Error(`attempt ${attempts}`)
        },
        { deadline: 40_000, intervalMs: 15_000, ...clock },
      ),
      /attempt 3/,
    )
    assert.equal(clock.now(), 30_000)
  })

  it('tries once when the deadline has passed', async () => {
    let attempts = 0
    await assert.rejects(
      retryUntil(
        () => {
          attempts++
          throw new Error('no')
        },
        { deadline: 0, intervalMs: 15_000, ...fakeClock() },
      ),
    )
    assert.equal(attempts, 1)
  })
})

describe('AWAITING_FIRST_PUBLISH', () => {
  it('with PUBLISH_ORDER, lists every public package exactly once', () => {
    const packagesDir = new URL('../../packages/', import.meta.url)
    const publicDirs = readdirSync(packagesDir)
      .filter((dir) => existsSync(new URL(`${dir}/package.json`, packagesDir)))
      .filter((dir) => !JSON.parse(readFileSync(new URL(`${dir}/package.json`, packagesDir), 'utf8')).private)
    const listed = [...PUBLISH_ORDER, ...AWAITING_FIRST_PUBLISH]
    assert.deepEqual([...listed].sort(), publicDirs.sort())
  })
})
