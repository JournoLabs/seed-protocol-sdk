import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addReleaseSection, formatCommitGroups, isVersionBump, parseCommitSubject, splitChangelog } from '../changelog.js'

describe('parseCommitSubject', () => {
  it('reads type, scope, breaking and description', () => {
    assert.deepEqual(parseCommitSubject('feat(publish)!: drop x'), {
      type: 'feat',
      scope: 'publish',
      breaking: true,
      description: 'drop x',
    })
  })
  it('treats non-conventional subjects as other', () => {
    assert.equal(parseCommitSubject('Saving progress').type, 'other')
  })
})

describe('isVersionBump', () => {
  it('recognizes release and bump commits', () => {
    assert.ok(isVersionBump('chore: release 0.7.3'))
    assert.ok(isVersionBump('v0.7.1'))
    assert.ok(isVersionBump('0.6.9'))
    assert.ok(isVersionBump('chore: bump workspace packages to 0.5.3'))
  })
  it('leaves ordinary commits', () => {
    assert.ok(!isVersionBump('fix(sdk): release the lock on error'))
    assert.ok(!isVersionBump('feat(release): retry a failed release'))
  })
})

describe('formatCommitGroups', () => {
  const commits = [
    { sha: 'aaaaaaaa1', subject: 'feat(publish): payment config' },
    { sha: 'bbbbbbbb2', subject: 'fix(sdk,publish): shared fix' },
    { sha: 'cccccccc3', subject: 'test(publish): more tests' },
    { sha: 'dddddddd4', subject: 'chore: release 0.7.3' },
    { sha: 'eeeeeeee5', subject: 'refactor!: remove decorators' },
    { sha: 'ffffffff6', subject: 'docs(publish): readme' },
  ]
  const out = formatCommitGroups(commits, 'publish')

  it('groups breaking, features, fixes, other in that order', () => {
    assert.ok(out.indexOf('#### Breaking') < out.indexOf('#### Features'))
    assert.ok(out.indexOf('#### Features') < out.indexOf('#### Fixes'))
    assert.ok(out.indexOf('#### Fixes') < out.indexOf('#### Other'))
  })
  it('drops the scope naming the package, keeps others, short shas', () => {
    assert.match(out, /- payment config \(aaaaaaaa\)/)
    assert.match(out, /- sdk: shared fix \(bbbbbbbb\)/)
  })
  it('leaves out test, chore and release commits', () => {
    assert.doesNotMatch(out, /more tests/)
    assert.doesNotMatch(out, /release 0\.7\.3/)
  })
  it('is empty when nothing is listable', () => {
    assert.equal(formatCommitGroups([{ sha: 'a', subject: 'test: x' }], 'sdk'), '')
  })
})

describe('splitChangelog / addReleaseSection', () => {
  const text = '# Changelog\n\nIntro.\n\n## Unreleased\n\n### Fixed\n\n- A fix.\n\n## 0.5.0\n\n- Old.\n'

  it('splits header, unreleased notes and older sections', () => {
    const { header, unreleased, rest } = splitChangelog(text)
    assert.equal(header, '# Changelog\n\nIntro.\n\n')
    assert.equal(unreleased, '### Fixed\n\n- A fix.')
    assert.equal(rest, '## 0.5.0\n\n- Old.\n')
  })

  it('turns Unreleased into the release section and appends the commits', () => {
    const out = addReleaseSection(text, { version: '0.7.4', date: '2026-10-15', commitGroups: '#### Fixes\n\n- x (1)' })
    assert.equal(
      out,
      '# Changelog\n\nIntro.\n\n## 0.7.4 (2026-10-15)\n\n### Fixed\n\n- A fix.\n\n### Commits\n\n#### Fixes\n\n- x (1)\n\n## 0.5.0\n\n- Old.\n',
    )
    assert.doesNotMatch(out, /Unreleased/)
  })

  it('creates a changelog for a package without one', () => {
    const out = addReleaseSection('', { version: '0.7.4', date: '2026-10-15', commitGroups: '#### Fixes\n\n- x (1)' })
    assert.match(out, /^# Changelog\n/)
    assert.match(out, /## 0\.7\.4 \(2026-10-15\)\n\n### Commits/)
  })

  it('changes nothing with no notes and no commits', () => {
    assert.equal(addReleaseSection('# Changelog\n\n## 0.5.0\n', { version: '1', date: 'd', commitGroups: '' }), '# Changelog\n\n## 0.5.0\n')
  })
})
