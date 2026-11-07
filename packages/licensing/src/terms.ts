/** Identifies the closed ODRL 2.2 profile whose semantics these terms follow (ADR 0034). */
export const TERMS_PROFILE = 'https://seedprotocol.io/odrl/seed-license/1'

export const ACTIONS = [
  'use',
  'reproduce',
  'distribute',
  'derive',
  'commercialize',
  'seed:aiTrain',
  'seed:aiInput',
  'seed:aiIndex',
  'seed:search',
] as const
export type Action = (typeof ACTIONS)[number]

export const USER_CLASSES = ['commercial', 'noncommercial', 'education', 'government', 'personal'] as const

export type Constraint =
  | { name: 'purpose'; operator: 'eq' | 'neq'; value: string }
  /** ISO 3166-1 alpha-2. */
  | { name: 'spatial'; operator: 'eq' | 'neq'; value: string }
  /** Unix seconds. */
  | { name: 'dateTime'; operator: 'gte' | 'lt'; value: number }
  /** Seconds. */
  | { name: 'elapsedTime'; operator: 'lte'; value: number }
  | { name: 'count'; operator: 'lte'; value: number }
  | { name: 'userClass'; operator: 'eq' | 'neq'; value: (typeof USER_CLASSES)[number] }

export interface Rule {
  action: Action
  /** What the rule applies to. Default 'work'. CC ND prohibits distributing adaptations, not making them. */
  target?: 'work' | 'adaptation'
  constraints?: Constraint[]
}

export type Duty =
  | { duty: 'attribute' }
  /** SPDX expression adaptations must use; default: the same license. */
  | { duty: 'shareAlike'; license?: string }
  /** Keep the license text and copyright notice. */
  | { duty: 'includeNotice' }
  /** GPL; `network: true` for AGPL. */
  | { duty: 'discloseSource'; network?: boolean }
  | { duty: 'stateChanges' }

/**
 * License terms: the reusable legal semantics of a license, without the economics of any offer.
 * `termsHash` is the SHA-256 of their RFC 8785 canonical JSON.
 */
export interface SeedLicenseTerms {
  profile: typeof TERMS_PROFILE
  /** SPDX license expression. */
  spdx: string
  /** `sha256`: 64 lowercase hex characters, no `0x`, of the legal text's bytes. Where the text is stored is not part of the terms. */
  legal: { sha256: string; lang: string; canonicalUrl: string }
  permissions: Rule[]
  prohibitions: Rule[]
  duties: Duty[]
  /** BUSL/FSL-style change of license: exactly one of `afterSeconds` and `at` (unix seconds). */
  transition?: { changeAt: { afterSeconds?: number; at?: number }; changeLicense: string }
  postTerm?: { derivatives: 'retain' | 'cease-distribution' | 'remove'; trainedModels: 'may-continue' | 'no-new-training' }
  grant: {
    transferable: boolean
    sublicensable: boolean
    exclusive: false
    revocableFor: 'breach-only' | 'never'
    warranty: 'as-is' | 'ownership'
    /** 'copyright-term' for CC and most open licenses; seconds otherwise. */
    duration: 'copyright-term' | number
  }
  governingLaw?: string
}
