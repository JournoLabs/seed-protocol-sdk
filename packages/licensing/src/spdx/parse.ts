import { DEPRECATED_IDS, EXCEPTION_IDS, LICENSE_IDS } from './list.generated'

export type SpdxNode =
  | { type: 'license'; id: string; plus: boolean; exception?: string }
  | { type: 'ref'; id: string; documentRef?: string }
  | { type: 'and' | 'or'; left: SpdxNode; right: SpdxNode }

export type SpdxParseResult =
  | { ok: true; ast: SpdxNode; ids: string[]; deprecated: string[] }
  | { ok: false; error: string }

const byLowerCase = (ids: readonly string[]) => new Map(ids.map((id) => [id.toLowerCase(), id]))
const licenses = byLowerCase(LICENSE_IDS)
const exceptions = byLowerCase(EXCEPTION_IDS)
const deprecatedIds = new Set(DEPRECATED_IDS)

const IDSTRING = /^[A-Za-z0-9.-]+$/
const OPERATORS = new Set(['AND', 'OR', 'WITH'])
/** Deeper parentheses are refused rather than recursed into, so hostile input can't overflow the stack. */
const MAX_DEPTH = 64

/** The id as the SPDX list spells it, matched case-insensitively, or undefined. Licenses only, not exceptions. */
export function isKnownSpdxId(id: string): string | undefined {
  return licenses.get(id.toLowerCase())
}

class SpdxSyntaxError extends Error {}

/**
 * Parses an SPDX license expression (SPDX 3.0 annex): `AND`, `OR`, `WITH`, parentheses, the `+`
 * suffix, `LicenseRef-` and `DocumentRef-…:LicenseRef-`. `WITH` binds tighter than `AND`, which
 * binds tighter than `OR`. Operators must be uppercase. Ids match case-insensitively and come back
 * as the list spells them.
 */
export function parseSpdx(expression: string): SpdxParseResult {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? []
  let position = 0
  let depth = 0
  const ids: string[] = []
  const deprecated: string[] = []

  const peek = () => tokens[position]
  const next = () => tokens[position++]

  function fail(message: string): never {
    throw new SpdxSyntaxError(message)
  }

  function parseOr(): SpdxNode {
    let left = parseAnd()
    while (peek() === 'OR') {
      next()
      left = { type: 'or', left, right: parseAnd() }
    }
    return left
  }

  function parseAnd(): SpdxNode {
    let left = parseWith()
    while (peek() === 'AND') {
      next()
      left = { type: 'and', left, right: parseWith() }
    }
    return left
  }

  function parseWith(): SpdxNode {
    const atom = parseAtom()
    if (peek() !== 'WITH') return atom
    next()
    const token = next()
    if (token === undefined) fail('expected an exception id after WITH')
    const exception = exceptions.get(token.toLowerCase())
    if (!exception) fail(`unknown exception id "${token}"`)
    if (atom.type !== 'license') fail('WITH applies to a listed license id only')
    return { ...atom, exception }
  }

  function parseAtom(): Exclude<SpdxNode, { type: 'and' | 'or' }> | SpdxNode {
    const token = next()
    if (token === undefined) fail('expected a license id')
    if (token === '(') {
      if (++depth > MAX_DEPTH) fail(`parentheses nested too deeply (more than ${MAX_DEPTH})`)
      const inner = parseOr()
      if (next() !== ')') fail('missing closing parenthesis')
      depth--
      return inner
    }
    if (token === ')') fail('unexpected closing parenthesis')
    if (OPERATORS.has(token)) fail(`unexpected ${token}`)
    if (OPERATORS.has(token.toUpperCase())) fail(`operators must be uppercase: "${token}"`)
    return parseId(token)
  }

  function remember(id: string) {
    if (!ids.includes(id)) ids.push(id)
  }

  function parseId(token: string): SpdxNode {
    const ref = /^(?:(DocumentRef-[^:]+):)?(LicenseRef-(.*))$/.exec(token)
    if (ref) {
      const [, documentRef, id, idstring] = ref
      if (!idstring || !IDSTRING.test(idstring)) fail(`bad LicenseRef "${token}"`)
      if (documentRef && !IDSTRING.test(documentRef.slice('DocumentRef-'.length))) fail(`bad DocumentRef "${token}"`)
      remember(id!)
      return documentRef ? { type: 'ref', id: id!, documentRef } : { type: 'ref', id: id! }
    }
    const plus = token.endsWith('+')
    const bare = plus ? token.slice(0, -1) : token
    const id = isKnownSpdxId(bare)
    if (!id) fail(`unknown license id "${token}"`)
    remember(id)
    if (deprecatedIds.has(id) && !deprecated.includes(id)) deprecated.push(id)
    return { type: 'license', id, plus }
  }

  try {
    if (tokens.length === 0) fail('empty expression')
    const ast = parseOr()
    if (position < tokens.length) {
      const token = tokens[position]!
      fail(OPERATORS.has(token.toUpperCase()) && !OPERATORS.has(token) ? `operators must be uppercase: "${token}"` : `unexpected "${token}"`)
    }
    return { ok: true, ast, ids, deprecated }
  } catch (error) {
    if (error instanceof SpdxSyntaxError) return { ok: false, error: error.message }
    throw error
  }
}
