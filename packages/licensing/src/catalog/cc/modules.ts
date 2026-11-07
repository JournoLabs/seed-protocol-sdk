import { TERMS_PROFILE, type Duty, type Rule, type SeedLicenseTerms } from '../../terms'
import type { Domain, LicenseModule } from '../types'
import { CC0_URLS, RESERVED_SPDX, RESERVED_URLS, ccSpdx, ccUrls, type CcCode } from './urls'

/** SHA-256 of legal/<spdx>.txt (SPDX license-list-data v3.29.0 text, or Seed's notice). */
const LEGAL_SHA256: Record<string, string> = {
  'CC0-1.0': 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
  'CC-BY-4.0': 'd557539df68e771cc1eedcc91d13f70fca930e508d11eedcafa4b15db49e3744',
  'CC-BY-SA-4.0': 'cde7883b9050a1104f4ac19a1572aafd6e5d7323b68351aaf51fbf4beba54966',
  'CC-BY-NC-4.0': 'cc97a2c4ff7723a1f25179dc7c18f676fa84191bbb36ea7d0061acaf3c102559',
  'CC-BY-NC-SA-4.0': '600ca4e25fe11762b75a97e714707fab48bb778374e92d24c6ca068791661c11',
  'CC-BY-ND-4.0': '4a9d465e981ae6bde7f117abbfb0e24f2cc1820e99a47efbe58593fa5c43fa29',
  'CC-BY-NC-ND-4.0': '4f3c4a321eb0c73182eee7afa3fe0111e24dec193f2d6febcf4207f26af26839',
  [RESERVED_SPDX]: 'e11f4786261aa29fffcbf5c8d51264b2463c285000ca284d9ec6ac627607dd8a',
}

const CC_DOMAINS: readonly Domain[] = Object.freeze(['media', 'news', 'academic', 'data'])
const ALL_DOMAINS: readonly Domain[] = Object.freeze(['software', 'media', 'data', 'ai-model', 'font', 'hardware', 'news', 'academic'])
const CREATIVE_COMMONS = Object.freeze({ name: 'Creative Commons', url: 'https://creativecommons.org' })

const NAMES: Record<CcCode, string> = {
  by: 'Attribution',
  'by-sa': 'Attribution-ShareAlike',
  'by-nc': 'Attribution-NonCommercial',
  'by-nc-sa': 'Attribution-NonCommercial-ShareAlike',
  'by-nd': 'Attribution-NoDerivatives',
  'by-nc-nd': 'Attribution-NonCommercial-NoDerivatives',
}

function legal(spdx: string, canonicalUrl: string) {
  return Object.freeze({ canonicalUrl, sha256: LEGAL_SHA256[spdx]!, lang: 'en' })
}

/** Permissions in the fixed order use, reproduce, distribute, derive, distribute(adaptation), commercialize. */
function ccTerms(code: CcCode): SeedLicenseTerms {
  const nc = code.includes('nc')
  const nd = code.includes('nd')
  const sa = code.includes('sa')
  const permissions: Rule[] = [{ action: 'reproduce' }, { action: 'distribute' }, { action: 'derive' }]
  if (!nd) permissions.push({ action: 'distribute', target: 'adaptation' })
  if (!nc) permissions.push({ action: 'commercialize' })
  const prohibitions: Rule[] = []
  if (nd) prohibitions.push({ action: 'distribute', target: 'adaptation' })
  if (nc) prohibitions.push({ action: 'commercialize' })
  const duties: Duty[] = [{ duty: 'attribute' }, { duty: 'includeNotice' }]
  if (sa) duties.push({ duty: 'shareAlike' })
  const spdx = ccSpdx(code)
  return {
    profile: TERMS_PROFILE,
    spdx,
    legal: { ...legal(spdx, ccUrls(code).canonicalUrl) },
    permissions,
    prohibitions,
    duties,
    grant: {
      transferable: false,
      sublicensable: false,
      exclusive: false,
      // CC 4.0 §6: terminates on breach, reinstated on cure.
      revocableFor: 'breach-only',
      warranty: 'as-is',
      duration: 'copyright-term',
    },
  }
}

function ccModule(code: CcCode): LicenseModule {
  const urls = ccUrls(code)
  const spdx = ccSpdx(code)
  return Object.freeze({
    id: `cc-${code}@4.0.0` as const,
    spdx,
    name: `Creative Commons ${NAMES[code]} 4.0 International`,
    shortName: `CC ${code.toUpperCase()} 4.0`,
    iri: urls.iri,
    domains: CC_DOMAINS,
    steward: CREATIVE_COMMONS,
    legal: legal(spdx, urls.canonicalUrl),
    stewardDeedUrl: urls.stewardDeedUrl,
    warnings: Object.freeze(code.includes('nc') ? (['irrevocable', 'nc-ambiguity'] as const) : (['irrevocable'] as const)),
    toTerms: () => ccTerms(code),
  })
}

const cc0: LicenseModule = Object.freeze({
  id: 'cc0@1.0.0' as const,
  spdx: 'CC0-1.0',
  name: 'Creative Commons Zero v1.0 Universal',
  shortName: 'CC0 1.0',
  iri: CC0_URLS.iri,
  domains: CC_DOMAINS,
  steward: CREATIVE_COMMONS,
  legal: legal('CC0-1.0', CC0_URLS.canonicalUrl),
  stewardDeedUrl: CC0_URLS.stewardDeedUrl,
  warnings: Object.freeze(['irrevocable'] as const),
  toTerms: (): SeedLicenseTerms => ({
    profile: TERMS_PROFILE,
    spdx: 'CC0-1.0',
    legal: { ...legal('CC0-1.0', CC0_URLS.canonicalUrl) },
    permissions: [
      { action: 'use' },
      { action: 'reproduce' },
      { action: 'distribute' },
      { action: 'derive' },
      { action: 'distribute', target: 'adaptation' },
      { action: 'commercialize' },
    ],
    prohibitions: [],
    duties: [],
    // CC0 1.0 §3: the fallback license is non transferable and non sublicensable.
    grant: { transferable: false, sublicensable: false, exclusive: false, revocableFor: 'never', warranty: 'as-is', duration: 'copyright-term' },
  }),
})

const allRightsReserved: LicenseModule = Object.freeze({
  id: 'all-rights-reserved@1.0.0' as const,
  spdx: RESERVED_SPDX,
  name: 'All rights reserved',
  shortName: 'All rights reserved',
  domains: ALL_DOMAINS,
  steward: Object.freeze({ name: 'Seed Protocol', url: 'https://seedprotocol.io' }),
  legal: legal(RESERVED_SPDX, RESERVED_URLS.canonicalUrl),
  toTerms: (): SeedLicenseTerms => ({
    profile: TERMS_PROFILE,
    spdx: RESERVED_SPDX,
    legal: { ...legal(RESERVED_SPDX, RESERVED_URLS.canonicalUrl) },
    permissions: [],
    prohibitions: [],
    duties: [],
    grant: { transferable: false, sublicensable: false, exclusive: false, revocableFor: 'never', warranty: 'as-is', duration: 'copyright-term' },
  }),
})

/** CC0, the six CC BY 4.0 licenses and reserved rights, in the order a picker shows them. */
export const creativeCommons: readonly LicenseModule[] = Object.freeze([
  cc0,
  ccModule('by'),
  ccModule('by-sa'),
  ccModule('by-nc'),
  ccModule('by-nc-sa'),
  ccModule('by-nd'),
  ccModule('by-nc-nd'),
  allRightsReserved,
])
