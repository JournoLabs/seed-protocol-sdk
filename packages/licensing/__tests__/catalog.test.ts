import { describe, expect, it } from 'vitest'
import { createLicenseCatalog, parseSpdx, termsHash, validateTerms } from '../src'
import { creativeCommons } from '../src/catalog/cc'

const catalog = createLicenseCatalog(creativeCommons)

describe('the cc catalog', () => {
  it('lists the eight modules in order', () =>
    expect(catalog.list().map((m) => m.spdx)).toEqual([
      'CC0-1.0',
      'CC-BY-4.0',
      'CC-BY-SA-4.0',
      'CC-BY-NC-4.0',
      'CC-BY-NC-SA-4.0',
      'CC-BY-ND-4.0',
      'CC-BY-NC-ND-4.0',
      'LicenseRef-seed-all-rights-reserved-1',
    ]))

  it('every module validates and parses', () => {
    for (const m of creativeCommons) {
      expect(validateTerms(m.toTerms()).ok, m.id).toBe(true)
      expect(parseSpdx(m.spdx).ok, m.id).toBe(true)
      expect(m.toTerms().spdx).toBe(m.spdx)
    }
  })

  it('round-trips get, bySpdx and byTermsHash', () => {
    for (const m of creativeCommons) {
      expect(catalog.get(m.id)).toBe(m)
      expect(catalog.bySpdx(m.spdx)).toBe(m)
      const found = catalog.byTermsHash(termsHash(m.toTerms()))
      expect(found?.module).toBe(m)
      expect(found?.terms).toEqual(m.toTerms())
    }
    expect(catalog.get('nope@1.0.0')).toBeUndefined()
    expect(catalog.byTermsHash('0x' + '0'.repeat(64))).toBeUndefined()
  })

  it('pins every termsHash', () =>
    expect(Object.fromEntries(creativeCommons.map((m) => [m.id, termsHash(m.toTerms())]))).toMatchSnapshot())

  it('gives eight distinct hashes', () =>
    expect(new Set(creativeCommons.map((m) => termsHash(m.toTerms()))).size).toBe(8))

  it('returns fresh terms each call', () => {
    const m = catalog.get('cc-by@4.0.0')!
    const before = termsHash(m.toTerms())
    const terms = m.toTerms()
    terms.permissions.pop()
    ;(terms.grant as { transferable: boolean }).transferable = true
    expect(termsHash(m.toTerms())).toBe(before)
  })

  it('freezes modules', () => expect(Object.isFrozen(creativeCommons[0])).toBe(true))

  it('filters by domain', () => {
    expect(catalog.list({ domain: 'software' }).map((m) => m.id)).toEqual(['all-rights-reserved@1.0.0'])
    expect(catalog.list({ domain: 'news' })).toHaveLength(8)
  })

  it('maps the CC licenses as the spec says', () => {
    const terms = (id: string) => catalog.get(id)!.toTerms()
    const has = (list: { action: string; target?: string }[], action: string, target = 'work') =>
      list.some((r) => r.action === action && (r.target ?? 'work') === target)
    expect(has(terms('cc-by-nc@4.0.0').prohibitions, 'commercialize')).toBe(true)
    expect(has(terms('cc-by-nc@4.0.0').permissions, 'commercialize')).toBe(false)
    expect(has(terms('cc-by@4.0.0').permissions, 'commercialize')).toBe(true)
    expect(has(terms('cc-by-nd@4.0.0').prohibitions, 'distribute', 'adaptation')).toBe(true)
    expect(has(terms('cc-by-nd@4.0.0').permissions, 'derive')).toBe(true)
    expect(terms('cc-by-sa@4.0.0').duties).toContainEqual({ duty: 'shareAlike' })
    expect(terms('cc0@1.0.0').duties).toEqual([])
    expect(terms('cc0@1.0.0').grant.revocableFor).toBe('never')
    expect(terms('cc-by@4.0.0').grant.revocableFor).toBe('breach-only')
    const reserved = terms('all-rights-reserved@1.0.0')
    expect([reserved.permissions, reserved.prohibitions, reserved.duties]).toEqual([[], [], []])
  })
})

describe('createLicenseCatalog', () => {
  it('rejects duplicate ids and SPDX ids', () => {
    expect(() => createLicenseCatalog([creativeCommons[0]!, creativeCommons[0]!])).toThrow(/duplicate/i)
    expect(() => createLicenseCatalog([creativeCommons[1]!, { ...creativeCommons[1]!, id: 'other@1.0.0' }])).toThrow(/duplicate/i)
  })

  it('rejects a module whose terms are invalid, naming it', () =>
    expect(() =>
      createLicenseCatalog([{ ...creativeCommons[1]!, id: 'broken@1.0.0', toTerms: () => ({}) as never }]),
    ).toThrow(/broken@1\.0\.0/))
})
