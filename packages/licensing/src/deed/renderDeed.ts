import { UnsupportedLocaleError } from '../errors'
import type { SeedLicenseTerms } from '../terms'
import { EN_NONCOMMERCIAL_NOTE, EN_NOT_COVERED, EN_RULE_TEXT, EN_SEE_LEGAL_TEXT, enDisclaimer } from './en'
import { deriveRules, SECTION_OF, type DeedSection, type RuleId } from './rules'

export type DeedLine = { rule: RuleId | 'see-legal-text'; text: string }

export interface Deed {
  template: 'seed-deed/1.0.0'
  /** False until counsel reviews the sentence templates. */
  reviewed: false
  disclaimer: string
  youCan: DeedLine[]
  youMust: DeedLine[]
  youCannot: DeedLine[]
  whenTimeRunsOut: DeedLine[]
  creatorPromises: DeedLine[]
  notCovered: string[]
  stewardDeedUrl?: string
}

export type RenderDeedOptions = {
  locale: 'en'
  /** Where the legal text is served; default `terms.legal.canonicalUrl`. */
  legalLocation?: string
  /** The steward's own deed, passed through for the UI to link. */
  stewardDeedUrl?: string
}

export function assertLocale(locale: string): void {
  if (locale !== 'en') throw new UnsupportedLocaleError(locale)
}

/**
 * The plain-language summary of license terms, as data. Every line names the rule it came from;
 * a term no rule covers becomes one "see the legal text" line in its section.
 */
export function renderDeed(terms: SeedLicenseTerms, options: RenderDeedOptions): Deed {
  assertLocale(options.locale)
  const { rules, uncovered } = deriveRules(terms)
  const sections: Record<DeedSection, DeedLine[]> = {
    youCan: [],
    youMust: [],
    youCannot: [],
    whenTimeRunsOut: [],
    creatorPromises: [],
  }
  for (const rule of rules) sections[SECTION_OF[rule]].push({ rule, text: EN_RULE_TEXT[rule] })
  for (const section of uncovered) sections[section].push({ rule: 'see-legal-text', text: EN_SEE_LEGAL_TEXT })

  const notCovered: string[] = [...EN_NOT_COVERED]
  if (rules.includes('noncommercial')) notCovered.push(EN_NONCOMMERCIAL_NOTE)

  const deed: Deed = {
    template: 'seed-deed/1.0.0',
    reviewed: false,
    disclaimer: enDisclaimer(options.legalLocation ?? terms.legal.canonicalUrl, terms.legal.sha256),
    ...sections,
    notCovered,
  }
  if (options.stewardDeedUrl) deed.stewardDeedUrl = options.stewardDeedUrl
  return deed
}
