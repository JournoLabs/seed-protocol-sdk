import { parseSpdx } from './spdx/parse'
import { ACTIONS, TERMS_PROFILE, USER_CLASSES, type SeedLicenseTerms } from './terms'

export type TermsValidationError = { path: string; message: string }
export type TermsValidationResult = { ok: true; terms: SeedLicenseTerms } | { ok: false; errors: TermsValidationError[] }

type Obj = Record<string, unknown>

const SHA256_HEX = /^[0-9a-f]{64}$/
const COUNTRY = /^[A-Z]{2}$/

const CONSTRAINT_OPERATORS: Record<string, readonly string[]> = {
  purpose: ['eq', 'neq'],
  spatial: ['eq', 'neq'],
  dateTime: ['gte', 'lt'],
  elapsedTime: ['lte'],
  count: ['lte'],
  userClass: ['eq', 'neq'],
}

/**
 * Checks that a value is valid {@link SeedLicenseTerms}: the shape (no unknown keys, integers only),
 * parseable SPDX expressions, and no contradictions: the same action and target both permitted and
 * prohibited, share-alike without a derive permission, a transition with neither or both times.
 * An optional key whose value is `undefined` counts as absent. Never throws.
 */
export function validateTerms(terms: unknown): TermsValidationResult {
  const errors: TermsValidationError[] = []
  const err = (path: string, message: string) => errors.push({ path, message })

  const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
  const present = (o: Obj, key: string) => o[key] !== undefined

  function object(value: unknown, path: string, required: string[], optional: string[] = []): value is Obj {
    if (!isObj(value)) {
      err(path, 'must be an object')
      return false
    }
    for (const key of Object.keys(value)) {
      if (!required.includes(key) && !optional.includes(key) && value[key] !== undefined) err(join(path, key), 'unknown key')
    }
    for (const key of required) if (!present(value, key)) err(join(path, key), 'is required')
    return true
  }
  function string(value: unknown, path: string): value is string {
    if (typeof value === 'string') return true
    err(path, 'must be a string')
    return false
  }
  function integer(value: unknown, path: string, min = 0): value is number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= min) return true
    err(path, `must be an integer of at least ${min}`)
    return false
  }
  function oneOf(value: unknown, path: string, allowed: readonly unknown[]) {
    if (!allowed.includes(value)) err(path, `must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`)
  }
  function boolean(value: unknown, path: string) {
    if (typeof value !== 'boolean') err(path, 'must be a boolean')
  }
  function spdx(value: unknown, path: string) {
    if (!string(value, path)) return
    const parsed = parseSpdx(value)
    if (!parsed.ok) err(path, `not an SPDX expression: ${parsed.error}`)
  }
  function array(value: unknown, path: string, each: (item: unknown, path: string) => void) {
    if (!Array.isArray(value)) return err(path, 'must be an array')
    value.forEach((item, i) => each(item, `${path}[${i}]`))
  }

  function constraint(value: unknown, path: string) {
    if (!object(value, path, ['name', 'operator', 'value'])) return
    const name = value.name
    if (typeof name !== 'string' || !(name in CONSTRAINT_OPERATORS)) {
      return err(join(path, 'name'), `must be one of ${Object.keys(CONSTRAINT_OPERATORS).join(', ')}`)
    }
    oneOf(value.operator, join(path, 'operator'), CONSTRAINT_OPERATORS[name]!)
    const v = join(path, 'value')
    if (name === 'purpose') string(value.value, v)
    else if (name === 'spatial') {
      if (string(value.value, v) && !COUNTRY.test(value.value)) err(v, 'must be an ISO 3166-1 alpha-2 code')
    } else if (name === 'userClass') oneOf(value.value, v, USER_CLASSES)
    else integer(value.value, v)
  }

  function rule(value: unknown, path: string) {
    if (!object(value, path, ['action'], ['target', 'constraints'])) return
    oneOf(value.action, join(path, 'action'), ACTIONS)
    if (present(value, 'target')) oneOf(value.target, join(path, 'target'), ['work', 'adaptation'])
    if (present(value, 'constraints')) array(value.constraints, join(path, 'constraints'), constraint)
  }

  function duty(value: unknown, path: string) {
    if (!isObj(value)) return err(path, 'must be an object')
    const optional: Record<string, string[]> = {
      attribute: [],
      shareAlike: ['license'],
      includeNotice: [],
      discloseSource: ['network'],
      stateChanges: [],
    }
    if (typeof value.duty !== 'string' || !(value.duty in optional)) {
      return err(join(path, 'duty'), `must be one of ${Object.keys(optional).join(', ')}`)
    }
    object(value, path, ['duty'], optional[value.duty])
    if (value.duty === 'shareAlike' && present(value, 'license')) spdx(value.license, join(path, 'license'))
    if (value.duty === 'discloseSource' && present(value, 'network')) boolean(value.network, join(path, 'network'))
  }

  const top = ['profile', 'spdx', 'legal', 'permissions', 'prohibitions', 'duties', 'grant']
  if (!object(terms, '', top, ['transition', 'postTerm', 'governingLaw'])) return { ok: false, errors }

  if (terms.profile !== TERMS_PROFILE) err('profile', `must be ${TERMS_PROFILE}`)
  if (present(terms, 'spdx')) spdx(terms.spdx, 'spdx')

  if (present(terms, 'legal') && object(terms.legal, 'legal', ['sha256', 'lang', 'canonicalUrl'])) {
    if (string(terms.legal.sha256, 'legal.sha256') && !SHA256_HEX.test(terms.legal.sha256)) {
      err('legal.sha256', 'must be 64 lowercase hex characters without 0x')
    }
    string(terms.legal.lang, 'legal.lang')
    string(terms.legal.canonicalUrl, 'legal.canonicalUrl')
  }

  for (const key of ['permissions', 'prohibitions'] as const) if (present(terms, key)) array(terms[key], key, rule)
  if (present(terms, 'duties')) array(terms.duties, 'duties', duty)

  if (present(terms, 'transition') && object(terms.transition, 'transition', ['changeAt', 'changeLicense'])) {
    const { changeAt, changeLicense } = terms.transition
    if (object(changeAt, 'transition.changeAt', [], ['afterSeconds', 'at'])) {
      const after = present(changeAt, 'afterSeconds')
      const at = present(changeAt, 'at')
      if (after === at) err('transition.changeAt', 'must have exactly one of afterSeconds and at')
      if (after) integer(changeAt.afterSeconds, 'transition.changeAt.afterSeconds', 1)
      if (at) integer(changeAt.at, 'transition.changeAt.at')
    }
    spdx(changeLicense, 'transition.changeLicense')
  }

  if (present(terms, 'postTerm') && object(terms.postTerm, 'postTerm', ['derivatives', 'trainedModels'])) {
    oneOf(terms.postTerm.derivatives, 'postTerm.derivatives', ['retain', 'cease-distribution', 'remove'])
    oneOf(terms.postTerm.trainedModels, 'postTerm.trainedModels', ['may-continue', 'no-new-training'])
  }

  const grantKeys = ['transferable', 'sublicensable', 'exclusive', 'revocableFor', 'warranty', 'duration']
  if (present(terms, 'grant') && object(terms.grant, 'grant', grantKeys)) {
    const g = terms.grant
    boolean(g.transferable, 'grant.transferable')
    boolean(g.sublicensable, 'grant.sublicensable')
    if (g.exclusive !== false) err('grant.exclusive', 'must be false')
    oneOf(g.revocableFor, 'grant.revocableFor', ['breach-only', 'never'])
    oneOf(g.warranty, 'grant.warranty', ['as-is', 'ownership'])
    if (g.duration !== 'copyright-term') integer(g.duration, 'grant.duration', 1)
  }

  if (present(terms, 'governingLaw')) string(terms.governingLaw, 'governingLaw')

  // Contradictions, checked only when the shapes are sound.
  if (errors.length === 0) {
    const t = terms as unknown as SeedLicenseTerms
    const key = (r: { action: string; target?: string }) => `${r.action}/${r.target ?? 'work'}`
    const permitted = new Set(t.permissions.map(key))
    t.prohibitions.forEach((r, i) => {
      if (permitted.has(key(r))) err(`prohibitions[${i}]`, `${key(r)} is also permitted`)
    })
    t.duties.forEach((d, i) => {
      if (d.duty === 'shareAlike' && !t.permissions.some((r) => r.action === 'derive')) {
        err(`duties[${i}]`, 'shareAlike needs a derive permission')
      }
    })
  }

  return errors.length === 0 ? { ok: true, terms: terms as unknown as SeedLicenseTerms } : { ok: false, errors }
}

function join(path: string, key: string) {
  return path ? `${path}.${key}` : key
}
