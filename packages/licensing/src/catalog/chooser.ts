import type { LicenseModule } from './types'

export interface ChooserQuestion {
  id: string
  prompt: string
  /** `ends`: choosing it answers the chooser; later questions aren't asked. */
  choices: { id: string; label: string; ends?: true }[]
}

/**
 * Questions that name a license, as data. Ids are the interface; prompts and labels are default
 * copy an app may replace.
 */
export interface Chooser {
  questions: readonly ChooserQuestion[]
  /** Null for an incomplete answer set, an unknown question or choice, or an answer after an ending choice. */
  resolve(answers: Record<string, string>): { spdx: string; termsHash: string; module: LicenseModule } | null
  /** The answers that lead to `spdx`, or null when no path does. */
  answersFor(spdx: string): Record<string, string> | null
}
