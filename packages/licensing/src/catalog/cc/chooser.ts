import { termsHash } from '../../hash'
import type { Chooser, ChooserQuestion } from '../chooser'
import { creativeCommons } from './modules'
import { RESERVED_SPDX } from './urls'

const questions: readonly ChooserQuestion[] = Object.freeze([
  {
    id: 'republish',
    prompt: 'May others republish it?',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No', ends: true },
    ],
  },
  {
    id: 'conditions',
    prompt: 'With credit, or with no conditions?',
    choices: [
      { id: 'credit', label: 'With credit' },
      { id: 'none', label: 'No conditions', ends: true },
    ],
  },
  {
    id: 'adapt',
    prompt: 'May they change it?',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'shareAlike', label: 'Yes, if they share alike' },
      { id: 'no', label: 'No' },
    ],
  },
  {
    id: 'commercial',
    prompt: 'May they use it commercially?',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
  },
] satisfies ChooserQuestion[])

/** Each complete answer path, as `id=choice` pairs joined by `&` in question order, to its SPDX id. */
const PATHS: Record<string, string> = {
  'republish=no': RESERVED_SPDX,
  'republish=yes&conditions=none': 'CC0-1.0',
  'republish=yes&conditions=credit&adapt=yes&commercial=yes': 'CC-BY-4.0',
  'republish=yes&conditions=credit&adapt=shareAlike&commercial=yes': 'CC-BY-SA-4.0',
  'republish=yes&conditions=credit&adapt=no&commercial=yes': 'CC-BY-ND-4.0',
  'republish=yes&conditions=credit&adapt=yes&commercial=no': 'CC-BY-NC-4.0',
  'republish=yes&conditions=credit&adapt=shareAlike&commercial=no': 'CC-BY-NC-SA-4.0',
  'republish=yes&conditions=credit&adapt=no&commercial=no': 'CC-BY-NC-ND-4.0',
}

const pathKey = (answers: Record<string, string>) =>
  questions
    .filter((q) => q.id in answers)
    .map((q) => `${q.id}=${answers[q.id]}`)
    .join('&')

/** The four questions PermaPress's picker asks, resolving to CC0, the six CC BY 4.0 licenses or reserved rights. */
export const ccChooser: Chooser = Object.freeze({
  questions,
  resolve(answers: Record<string, string>) {
    if (Object.keys(answers).some((key) => !questions.some((q) => q.id === key))) return null
    const spdx = PATHS[pathKey(answers)]
    const module = spdx ? creativeCommons.find((m) => m.spdx === spdx) : undefined
    return module ? { spdx: module.spdx, termsHash: termsHash(module.toTerms()), module } : null
  },
  answersFor(spdx: string) {
    const entry = Object.entries(PATHS).find(([, id]) => id === spdx)
    return entry ? Object.fromEntries(entry[0].split('&').map((pair) => pair.split('=') as [string, string])) : null
  },
})
