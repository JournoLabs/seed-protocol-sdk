import type { RuleId } from './rules'

/** Deed template seed-deed/1.0.0, English. Draft copy, not yet reviewed by counsel. */
export const EN_RULE_TEXT: Record<RuleId, string> = {
  'use-any-purpose': 'Use it for any purpose.',
  share: 'Share it: copy and redistribute it in any medium or format.',
  adapt: 'Adapt it: remix, transform and build on it, and share what you make.',
  'commercial-use': 'Use it commercially.',
  attribution: 'Give credit: name the creator, link to the license and say if you changed it.',
  'include-notice': 'Keep the copyright and license notices that come with it.',
  'share-alike': 'Share adaptations under the same license.',
  'no-conditions': "Nothing. You don't need to give credit.",
  noncommercial: 'Use it for commercial purposes.',
  'no-derivatives': 'Share adapted versions. You may adapt it for your own use.',
  'permission-required': "Republish, share or adapt it without the rights holder's permission.",
  'lasts-copyright-term': 'The license lasts as long as the copyright does.',
  'ends-on-breach': 'It ends if you break its terms. The legal text says how it can be restored.',
  irrevocable: "The creator can't withdraw it from anything already shared under it.",
  'as-is': "No warranties: it comes as is, and the creator doesn't promise to hold every right you might need.",
}

export const EN_SEE_LEGAL_TEXT = 'Further conditions apply; see the legal text.'

export const enDisclaimer = (location: string, sha256: string) =>
  `This summary is not the license; the legal text at ${location} (sha256 ${sha256}) governs.`

export const EN_NOT_COVERED = [
  'Exceptions and limitations to copyright, such as fair use, still apply.',
  'Moral rights, privacy and publicity rights are not covered.',
] as const

export const EN_NONCOMMERCIAL_NOTE = 'What counts as non-commercial is defined by the legal text, not this summary.'
