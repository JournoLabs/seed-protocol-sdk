import type { Rule, SeedLicenseTerms } from '../terms'

export type DeedSection = 'youCan' | 'youMust' | 'youCannot' | 'whenTimeRunsOut' | 'creatorPromises'

export const RULE_IDS = [
  'use-any-purpose',
  'share',
  'adapt',
  'commercial-use',
  'attribution',
  'include-notice',
  'share-alike',
  'no-conditions',
  'noncommercial',
  'no-derivatives',
  'permission-required',
  'lasts-copyright-term',
  'ends-on-breach',
  'irrevocable',
  'as-is',
] as const
export type RuleId = (typeof RULE_IDS)[number]

export const SECTION_OF: Record<RuleId, DeedSection> = {
  'use-any-purpose': 'youCan',
  share: 'youCan',
  adapt: 'youCan',
  'commercial-use': 'youCan',
  attribution: 'youMust',
  'include-notice': 'youMust',
  'share-alike': 'youMust',
  'no-conditions': 'youMust',
  noncommercial: 'youCannot',
  'no-derivatives': 'youCannot',
  'permission-required': 'youCannot',
  'lasts-copyright-term': 'whenTimeRunsOut',
  'ends-on-breach': 'whenTimeRunsOut',
  irrevocable: 'creatorPromises',
  'as-is': 'creatorPromises',
}

export type DerivedRules = {
  /** In vocabulary order. */
  rules: RuleId[]
  /** Sections holding a term no rule covers. */
  uncovered: DeedSection[]
}

/**
 * Which rules the terms trigger. Each rule claims the term elements it describes; a permission,
 * prohibition or duty that no rule claims, or any transition or post-term block, is reported as
 * uncovered so the deed points to the legal text instead of leaving it out. A rule with
 * constraints is never claimed: the 1.0.0 vocabulary has no sentences for constraints.
 */
export function deriveRules(terms: SeedLicenseTerms): DerivedRules {
  const fired = new Set<RuleId>()
  const claimedPermissions = new Set<number>()
  const claimedProhibitions = new Set<number>()
  const claimedDuties = new Set<number>()

  const find = (list: Rule[], action: string, target = 'work') =>
    list.findIndex((r) => r.action === action && (r.target ?? 'work') === target && !r.constraints?.length)
  const permit = (action: string, target?: string) => find(terms.permissions, action, target)
  const prohibit = (action: string, target?: string) => find(terms.prohibitions, action, target)
  const claim = (set: Set<number>, ...indexes: number[]) => indexes.forEach((i) => set.add(i))

  const use = permit('use')
  if (use >= 0) {
    fired.add('use-any-purpose')
    claim(claimedPermissions, use)
  }
  const reproduce = permit('reproduce')
  const distribute = permit('distribute')
  if (reproduce >= 0 && distribute >= 0) {
    fired.add('share')
    claim(claimedPermissions, reproduce, distribute)
  }
  const derive = permit('derive')
  const distributeAdaptation = permit('distribute', 'adaptation')
  if (derive >= 0 && distributeAdaptation >= 0) {
    fired.add('adapt')
    claim(claimedPermissions, derive, distributeAdaptation)
  }
  const commercialize = permit('commercialize')
  if (commercialize >= 0) {
    fired.add('commercial-use')
    claim(claimedPermissions, commercialize)
  }

  terms.duties.forEach((duty, i) => {
    const rule = ({ attribute: 'attribution', includeNotice: 'include-notice', shareAlike: 'share-alike' } as const)[
      duty.duty as 'attribute' | 'includeNotice' | 'shareAlike'
    ]
    // A share-alike duty naming another license needs the legal text.
    if (rule && !(duty.duty === 'shareAlike' && duty.license)) {
      fired.add(rule)
      claim(claimedDuties, i)
    }
  })

  const hasPermissions = terms.permissions.length > 0
  if (hasPermissions && terms.duties.length === 0) fired.add('no-conditions')

  const noCommercial = prohibit('commercialize')
  if (noCommercial >= 0) {
    fired.add('noncommercial')
    claim(claimedProhibitions, noCommercial)
  }
  const noAdaptations = prohibit('distribute', 'adaptation')
  if (noAdaptations >= 0) {
    fired.add('no-derivatives')
    claim(claimedProhibitions, noAdaptations)
    // Making an adaptation for yourself stays allowed; the no-derivatives sentence says so.
    if (derive >= 0) claim(claimedPermissions, derive)
  }
  if (!hasPermissions) fired.add('permission-required')

  if (hasPermissions) {
    if (terms.grant.duration === 'copyright-term') fired.add('lasts-copyright-term')
    if (terms.grant.revocableFor === 'breach-only') fired.add('ends-on-breach')
    fired.add('irrevocable')
    if (terms.grant.warranty === 'as-is') fired.add('as-is')
  }

  const uncovered = new Set<DeedSection>()
  if (terms.permissions.some((_, i) => !claimedPermissions.has(i))) uncovered.add('youCan')
  if (terms.duties.some((_, i) => !claimedDuties.has(i))) uncovered.add('youMust')
  if (terms.prohibitions.some((_, i) => !claimedProhibitions.has(i))) uncovered.add('youCannot')
  if (terms.transition || terms.postTerm || (hasPermissions && terms.grant.duration !== 'copyright-term')) uncovered.add('whenTimeRunsOut')
  if (hasPermissions && terms.grant.warranty !== 'as-is') uncovered.add('creatorPromises')

  return { rules: RULE_IDS.filter((id) => fired.has(id)), uncovered: [...uncovered] }
}
