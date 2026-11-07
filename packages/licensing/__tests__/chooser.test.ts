import { describe, expect, it } from 'vitest'
import { termsHash } from '../src'
import { ccChooser } from '../src/catalog/cc'

const PATHS: [Record<string, string>, string][] = [
  [{ republish: 'no' }, 'LicenseRef-seed-all-rights-reserved-1'],
  [{ republish: 'yes', conditions: 'none' }, 'CC0-1.0'],
  [{ republish: 'yes', conditions: 'credit', adapt: 'yes', commercial: 'yes' }, 'CC-BY-4.0'],
  [{ republish: 'yes', conditions: 'credit', adapt: 'shareAlike', commercial: 'yes' }, 'CC-BY-SA-4.0'],
  [{ republish: 'yes', conditions: 'credit', adapt: 'no', commercial: 'yes' }, 'CC-BY-ND-4.0'],
  [{ republish: 'yes', conditions: 'credit', adapt: 'yes', commercial: 'no' }, 'CC-BY-NC-4.0'],
  [{ republish: 'yes', conditions: 'credit', adapt: 'shareAlike', commercial: 'no' }, 'CC-BY-NC-SA-4.0'],
  [{ republish: 'yes', conditions: 'credit', adapt: 'no', commercial: 'no' }, 'CC-BY-NC-ND-4.0'],
]

describe('ccChooser', () => {
  it.each(PATHS)('%j resolves to %s', (answers, spdx) => {
    const result = ccChooser.resolve(answers)!
    expect(result.spdx).toBe(spdx)
    expect(result.module.spdx).toBe(spdx)
    expect(result.termsHash).toBe(termsHash(result.module.toTerms()))
    expect(ccChooser.answersFor(spdx)).toEqual(answers)
  })

  it.each<Record<string, string>>([
    {},
    { republish: 'yes' },
    { republish: 'no', conditions: 'credit' },
    { republish: 'yes', conditions: 'credit', adapt: 'maybe', commercial: 'no' },
    { republish: 'yes', conditions: 'credit', adapt: 'yes' },
    { republish: 'yes', conditions: 'none', extra: 'x' },
  ])('null for %j', (answers) => expect(ccChooser.resolve(answers)).toBeNull())

  it('null answers for licenses outside the chooser', () => expect(ccChooser.answersFor('MIT')).toBeNull())

  it('asks four questions in order, with the ending choices marked', () => {
    expect(ccChooser.questions.map((q) => q.id)).toEqual(['republish', 'conditions', 'adapt', 'commercial'])
    expect(ccChooser.questions[0]).toEqual({
      id: 'republish',
      prompt: 'May others republish it?',
      choices: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No', ends: true },
      ],
    })
    expect(ccChooser.questions[2]!.choices.map((c) => c.label)).toEqual(['Yes', 'Yes, if they share alike', 'No'])
  })
})
