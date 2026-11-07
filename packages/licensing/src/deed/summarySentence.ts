import type { SeedLicenseTerms } from '../terms'
import { assertLocale } from './renderDeed'
import { deriveRules } from './rules'

/**
 * One sentence that says what others may do, built from the same rules as the deed. Terms with a
 * condition the rules don't cover end with "Other conditions apply." rather than leaving it out.
 */
export function summarySentence(terms: SeedLicenseTerms, options: { locale: 'en' }): string {
  assertLocale(options.locale)
  const { rules, uncovered } = deriveRules(terms)
  const has = (rule: (typeof rules)[number]) => rules.includes(rule)
  const tail = uncovered.length > 0 ? ' Other conditions apply.' : ''

  if (has('permission-required')) return `Others need permission to republish this.${tail}`
  if (has('no-conditions') && has('use-any-purpose')) return `Anyone may use it for any purpose, with no conditions.${tail}`

  const verb = has('adapt') ? 'republish and adapt it' : has('no-derivatives') ? 'republish it unchanged' : 'republish it'
  const parts = [
    verb,
    has('commercial-use') ? ', including commercially,' : '',
    has('attribution') ? ' with credit' : '',
    has('share-alike') ? ', if they share adaptations under the same license' : '',
    has('noncommercial') ? ', but not commercially' : '',
  ]
  return `Anyone may ${parts.join('').replace(/,$/, '')}.${tail}`
}
