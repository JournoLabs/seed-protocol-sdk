import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { changedReleasedSections, isCheckedVersion, releasedSections } from '../check-released-changelogs.js'

const changelog = (lines083) => `# Changelog

## Unreleased

- later work

## 0.8.3 (2026-11-23)

${lines083}

## 0.8.2 (2026-11-09)

- old
`

describe('releasedSections', () => {
  it('splits a changelog into its released sections and leaves Unreleased out', () => {
    const sections = releasedSections(changelog('- a'))
    assert.deepEqual([...sections.keys()], ['0.8.3', '0.8.2'])
    assert.equal(sections.get('0.8.3'), '## 0.8.3 (2026-11-23)\n\n- a')
  })
})

describe('changedReleasedSections', () => {
  const at = (text) => () => releasedSections(text)
  const base = { packageDir: 'publish', corrections: [] }

  it('passes when the section equals its text at the tag', () => {
    const current = releasedSections(changelog('- a'))
    assert.deepEqual(changedReleasedSections({ ...base, current, atTag: at(changelog('- a')) }), [])
  })

  it('fails when a line was added to the released section after the tag', () => {
    const current = releasedSections(changelog('- a\n- merged in from a branch'))
    const errors = changedReleasedSections({ ...base, current, atTag: at(changelog('- a')) })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /packages\/publish\/CHANGELOG\.md.*0\.8\.3.*v0\.8\.3/)
  })

  it('does not count changes under Unreleased or trailing whitespace', () => {
    const current = releasedSections(changelog('- a  ').replace('later work', 'other work'))
    assert.deepEqual(changedReleasedSections({ ...base, current, atTag: at(changelog('- a')) }), [])
  })

  it('passes a corrected section that is listed with a reason', () => {
    const current = releasedSections(changelog('- a, corrected'))
    const corrections = [{ package: 'publish', version: '0.8.3', reason: 'wrong name' }]
    assert.deepEqual(changedReleasedSections({ ...base, corrections, current, atTag: at(changelog('- a')) }), [])
    assert.equal(
      changedReleasedSections({ ...base, packageDir: 'sdk', corrections, current, atTag: at(changelog('- a')) }).length,
      1,
    )
  })

  it('skips a version with no tag and a section the tag did not have', () => {
    const current = releasedSections(changelog('- changed'))
    assert.deepEqual(changedReleasedSections({ ...base, current, atTag: () => null }), [])
    assert.deepEqual(changedReleasedSections({ ...base, current, atTag: () => new Map() }), [])
  })
})

describe('isCheckedVersion', () => {
  it('starts at 0.8.3', () => {
    assert.equal(isCheckedVersion('0.8.2'), false)
    assert.equal(isCheckedVersion('0.8.3'), true)
    assert.equal(isCheckedVersion('0.9.0'), true)
    assert.equal(isCheckedVersion('1.0.0'), true)
  })
})
