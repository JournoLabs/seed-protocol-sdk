import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import {
  addReleaseSection,
  extendReleaseSection,
  formatCommitGroups,
  isVersionBump,
  mergeCommitGroups,
  parseCommitSubject,
  planReleaseChangelogs,
  splitChangelog,
  writeReleaseChangelogs,
} from '../changelog.js'

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

describe('mergeCommitGroups', () => {
  it('puts added lines on top of their group and adds missing groups in order', () => {
    const existing = '#### Fixes\n\n- old fix (1)\n\n#### Other\n\n- old other (2)'
    const added = '#### Features\n\n- new feat (3)\n\n#### Fixes\n\n- new fix (4)'
    assert.equal(
      mergeCommitGroups(existing, added),
      '#### Features\n\n- new feat (3)\n\n#### Fixes\n\n- new fix (4)\n- old fix (1)\n\n#### Other\n\n- old other (2)',
    )
  })
  it("doesn't repeat a line already listed", () => {
    assert.equal(mergeCommitGroups('#### Fixes\n\n- a (1)', '#### Fixes\n\n- a (1)'), '#### Fixes\n\n- a (1)')
  })
})

describe('extendReleaseSection', () => {
  const text =
    '# Changelog\n\nIntro.\n\n## 0.7.3 (2026-10-14)\n\nA note.\n\n### Commits\n\n#### Fixes\n\n- old fix (1)\n\n## 0.7.2 (2026-10-12)\n\n### Commits\n\n#### Fixes\n\n- older (0)\n'

  it("merges commits into the version's section, keeping its heading and the older sections", () => {
    const out = extendReleaseSection(text, { version: '0.7.3', date: '2026-10-16', commitGroups: '#### Fixes\n\n- new fix (2)' })
    assert.equal(
      out,
      '# Changelog\n\nIntro.\n\n## 0.7.3 (2026-10-14)\n\nA note.\n\n### Commits\n\n#### Fixes\n\n- new fix (2)\n- old fix (1)\n\n## 0.7.2 (2026-10-12)\n\n### Commits\n\n#### Fixes\n\n- older (0)\n',
    )
  })

  it("moves new Unreleased notes after the section's notes", () => {
    const withNotes = text.replace('## 0.7.3', '## Unreleased\n\nLate note.\n\n## 0.7.3')
    const out = extendReleaseSection(withNotes, { version: '0.7.3', date: '2026-10-16', commitGroups: '' })
    assert.match(out, /## 0\.7\.3 \(2026-10-14\)\n\nA note\.\n\nLate note\.\n\n### Commits\n\n#### Fixes\n\n- old fix \(1\)\n/)
    assert.doesNotMatch(out, /Unreleased/)
  })

  it('adds a Commits list to a section without one', () => {
    const out = extendReleaseSection('# Changelog\n\n## 0.7.3 (2026-10-14)\n\nA note.\n', {
      version: '0.7.3',
      date: '2026-10-16',
      commitGroups: '#### Fixes\n\n- x (1)',
    })
    assert.equal(out, '# Changelog\n\n## 0.7.3 (2026-10-14)\n\nA note.\n\n### Commits\n\n#### Fixes\n\n- x (1)\n')
  })

  it("adds the section when the package didn't have one for that version", () => {
    const out = extendReleaseSection(text, { version: '0.7.30', date: '2026-10-16', commitGroups: '#### Fixes\n\n- x (1)' })
    assert.match(out, /Intro\.\n\n## 0\.7\.30 \(2026-10-16\)\n\n### Commits\n\n#### Fixes\n\n- x \(1\)\n\n## 0\.7\.3 /)
  })

  it('changes nothing with no notes and no commits', () => {
    assert.equal(extendReleaseSection(text, { version: '0.7.3', date: 'd', commitGroups: '' }), text)
  })
})

describe('planReleaseChangelogs for a retry', () => {
  let root
  const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim()
  const commit = (file, content, subject) => {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), content)
    run('add', '-A')
    run('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', subject)
    return run('rev-parse', 'HEAD')
  }
  let releaseCommit, fixSha

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'changelog-retry-'))
    run('init', '--quiet')
    commit('packages/sdk/a.js', '1', 'feat(sdk): first')
    releaseCommit = commit(
      'packages/sdk/CHANGELOG.md',
      '# Changelog\n\n## 0.7.3 (2026-10-14)\n\n### Commits\n\n#### Features\n\n- first (00000000)\n',
      'chore: release 0.7.3',
    )
    fixSha = commit('packages/sdk/a.js', '2', 'fix(sdk): the release build')
    commit('packages/sdk/a.test.js', '1', 'test(sdk): cover it')
    commit('packages/publish/b.js', '1', 'fix(publish): another fix')
  })
  after(() => rmSync(root, { recursive: true, force: true }))

  it("lists the commits after the old tag's commit, per package", () => {
    const plan = planReleaseChangelogs({
      rootDir: root,
      packages: ['sdk', 'publish', 'feed'],
      version: '0.7.3',
      date: '2026-10-16',
      range: `${releaseCommit}..HEAD`,
      extend: true,
    })
    assert.deepEqual(
      plan.map((p) => [p.path, p.commitLines]),
      [
        ['packages/sdk/CHANGELOG.md', [`- the release build (${fixSha.slice(0, 8)})`]],
        ['packages/publish/CHANGELOG.md', [`- another fix (${run('rev-parse', 'HEAD').slice(0, 8)})`]],
      ],
    )
  })

  it("writes them into the existing 0.7.3 section, and a second retry adds nothing twice", () => {
    const options = { rootDir: root, packages: ['sdk'], version: '0.7.3', date: '2026-10-16', range: `${releaseCommit}..HEAD`, extend: true }
    assert.deepEqual(writeReleaseChangelogs(options), ['packages/sdk/CHANGELOG.md'])
    const expected = `# Changelog\n\n## 0.7.3 (2026-10-14)\n\n### Commits\n\n#### Features\n\n- first (00000000)\n\n#### Fixes\n\n- the release build (${fixSha.slice(0, 8)})\n`
    assert.equal(readFileSync(join(root, 'packages/sdk/CHANGELOG.md'), 'utf-8'), expected)
    assert.deepEqual(writeReleaseChangelogs(options), [])
  })
})
