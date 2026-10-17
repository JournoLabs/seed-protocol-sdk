import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ISOLATION_HEADERS,
  effectiveIsolationHeaders,
  isolationHeadersNotSetBy,
  resolveIsolationHeaders,
  zenfsModuleFor,
} from '../src/index'

describe('resolveIsolationHeaders', () => {
  it('returns the defaults for true or undefined', () => {
    expect(resolveIsolationHeaders(undefined)).toEqual(DEFAULT_ISOLATION_HEADERS)
    expect(resolveIsolationHeaders(true)).toEqual(DEFAULT_ISOLATION_HEADERS)
  })

  it('returns null for false', () => {
    expect(resolveIsolationHeaders(false)).toBeNull()
  })

  it('overrides individual values', () => {
    expect(resolveIsolationHeaders({ coep: 'require-corp' })).toEqual({
      ...DEFAULT_ISOLATION_HEADERS,
      'Cross-Origin-Embedder-Policy': 'require-corp',
    })
  })
})

describe('isolationHeadersNotSetBy', () => {
  it('drops headers the user set, ignoring case', () => {
    expect(
      isolationHeadersNotSetBy({ ...DEFAULT_ISOLATION_HEADERS }, { 'cross-origin-embedder-policy': 'require-corp' }),
    ).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })
  })
})

describe('effectiveIsolationHeaders', () => {
  it("prefers the user's value", () => {
    expect(
      effectiveIsolationHeaders({ ...DEFAULT_ISOLATION_HEADERS }, { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' }),
    ).toEqual({ ...DEFAULT_ISOLATION_HEADERS, 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' })
  })
})

describe('zenfsModuleFor', () => {
  it('maps promise APIs to @zenfs/core/promises', () => {
    expect(zenfsModuleFor('fs')).toBe('@zenfs/core')
    expect(zenfsModuleFor('node:fs/promises')).toBe('@zenfs/core/promises')
  })
})
