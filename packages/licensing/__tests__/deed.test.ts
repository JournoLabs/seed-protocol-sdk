import { describe, expect, it } from 'vitest'
import { renderDeed, summarySentence, UnsupportedLocaleError, type Deed, type LicenseModule } from '../src'
import { creativeCommons } from '../src/catalog/cc'

const SENTENCES: Record<string, string> = {
  'CC0-1.0': 'Anyone may use it for any purpose, with no conditions.',
  'CC-BY-4.0': 'Anyone may republish and adapt it, including commercially, with credit.',
  'CC-BY-SA-4.0':
    'Anyone may republish and adapt it, including commercially, with credit, if they share adaptations under the same license.',
  'CC-BY-NC-4.0': 'Anyone may republish and adapt it with credit, but not commercially.',
  'CC-BY-NC-SA-4.0':
    'Anyone may republish and adapt it with credit, if they share adaptations under the same license, but not commercially.',
  'CC-BY-ND-4.0': 'Anyone may republish it unchanged, including commercially, with credit.',
  'CC-BY-NC-ND-4.0': 'Anyone may republish it unchanged with credit, but not commercially.',
  'LicenseRef-seed-all-rights-reserved-1': 'Others need permission to republish this.',
}

const lines = (deed: Deed) => [...deed.youCan, ...deed.youMust, ...deed.youCannot, ...deed.whenTimeRunsOut, ...deed.creatorPromises]

describe('summarySentence', () => {
  it.each(creativeCommons.map((m) => [m.spdx, m] as const))('for %s', (spdx, m) =>
    expect(summarySentence(m.toTerms(), { locale: 'en' })).toBe(SENTENCES[spdx]))

  it('rejects other locales', () =>
    expect(() => summarySentence(creativeCommons[0]!.toTerms(), { locale: 'fr' as 'en' })).toThrow(UnsupportedLocaleError))
})

describe('renderDeed', () => {
  it('no catalog deed falls back to the legal text', () => {
    for (const m of creativeCommons) {
      const deed = renderDeed(m.toTerms(), { locale: 'en' })
      expect(lines(deed).some((l) => l.rule === 'see-legal-text'), m.id).toBe(false)
    }
  })

  it('opens with the disclaimer and honors legalLocation', () => {
    const terms = creativeCommons[3]!.toTerms()
    expect(renderDeed(terms, { locale: 'en' }).disclaimer).toBe(
      `This summary is not the license; the legal text at https://creativecommons.org/licenses/by-nc/4.0/legalcode.en (sha256 ${terms.legal.sha256}) governs.`,
    )
    expect(renderDeed(terms, { locale: 'en', legalLocation: 'ar://abc' }).disclaimer).toContain('legal text at ar://abc (')
  })

  it('adds the non-commercial note only where it applies', () => {
    expect(renderDeed(creativeCommons[3]!.toTerms(), { locale: 'en' }).notCovered).toEqual([
      'Exceptions and limitations to copyright, such as fair use, still apply.',
      'Moral rights, privacy and publicity rights are not covered.',
      'What counts as non-commercial is defined by the legal text, not this summary.',
    ])
    expect(renderDeed(creativeCommons[1]!.toTerms(), { locale: 'en' }).notCovered).toHaveLength(2)
  })

  it("doesn't tell CC0 readers that moral rights aren't covered, since CC0 waives them", () =>
    expect(renderDeed(creativeCommons[0]!.toTerms(), { locale: 'en' }).notCovered).toEqual([
      'Exceptions and limitations to copyright, such as fair use, still apply.',
    ]))

  it('marks the deed unreviewed and versioned, and passes the steward deed through', () => {
    const m = creativeCommons[1]!
    expect(renderDeed(m.toTerms(), { locale: 'en', stewardDeedUrl: m.stewardDeedUrl })).toMatchObject({
      template: 'seed-deed/1.0.0',
      reviewed: false,
      stewardDeedUrl: 'https://creativecommons.org/licenses/by/4.0/deed.en',
    })
  })

  it('puts each CC rule in its section', () => {
    const deed = renderDeed(creativeCommons[4]!.toTerms(), { locale: 'en' }) // BY-NC-SA
    expect(deed.youCan.map((l) => l.rule)).toEqual(['share', 'adapt'])
    expect(deed.youMust.map((l) => l.rule)).toEqual(['attribution', 'include-notice', 'share-alike'])
    expect(deed.youCannot.map((l) => l.rule)).toEqual(['noncommercial'])
    expect(deed.whenTimeRunsOut.map((l) => l.rule)).toEqual(['lasts-copyright-term', 'ends-on-breach'])
    expect(deed.creatorPromises.map((l) => l.rule)).toEqual(['irrevocable', 'as-is'])
  })

  it('tells reserved rights apart from an open license', () => {
    const deed = renderDeed(creativeCommons[7]!.toTerms(), { locale: 'en' })
    expect(lines(deed)).toEqual([
      { rule: 'permission-required', text: "Republish, share or adapt it without the rights holder's permission." },
    ])
  })

  it('covers an unknown term with a legal-text line', () => {
    const terms = { ...creativeCommons[1]!.toTerms(), duties: [{ duty: 'stateChanges' as const }] }
    expect(renderDeed(terms, { locale: 'en' }).youMust).toContainEqual({
      rule: 'see-legal-text',
      text: 'Further conditions apply; see the legal text.',
    })
  })

  it('covers a constrained permission with a legal-text line', () => {
    const base = creativeCommons[1]!.toTerms()
    const terms = { ...base, permissions: [...base.permissions, { action: 'seed:aiTrain' as const }] }
    expect(renderDeed(terms, { locale: 'en' }).youCan.at(-1)?.rule).toBe('see-legal-text')
  })

  it('rejects other locales', () =>
    expect(() => renderDeed(creativeCommons[0]!.toTerms(), { locale: 'de' as 'en' })).toThrow(UnsupportedLocaleError))

  it('writes every deed to one review file', async () => {
    await expect(creativeCommons.map(deedMarkdown).join('\n')).toMatchFileSnapshot('./__snapshots__/deeds.en.md')
  })
})

const SECTIONS: [keyof Deed, string][] = [
  ['youCan', 'You can'],
  ['youMust', 'You must'],
  ['youCannot', 'You cannot'],
  ['whenTimeRunsOut', 'When time runs out'],
  ['creatorPromises', 'What the creator is promising'],
]

function deedMarkdown(m: LicenseModule): string {
  const deed = renderDeed(m.toTerms(), { locale: 'en', stewardDeedUrl: m.stewardDeedUrl })
  const out = [`## ${m.shortName} (\`${m.spdx}\`)`, '', `> ${summarySentence(m.toTerms(), { locale: 'en' })}`, '', deed.disclaimer, '']
  for (const [key, title] of SECTIONS) {
    const section = deed[key] as { text: string }[]
    if (section.length === 0) continue
    out.push(`**${title}**`, '', ...section.map((l) => `- ${l.text}`), '')
  }
  out.push('**Not covered**', '', ...deed.notCovered.map((t) => `- ${t}`), '')
  if (deed.stewardDeedUrl) out.push(`Steward's deed: ${deed.stewardDeedUrl}`, '')
  return out.join('\n')
}
