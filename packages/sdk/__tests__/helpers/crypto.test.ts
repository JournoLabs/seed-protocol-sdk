import { describe, it, expect } from 'vitest'
import { getDeterministicId, getDeterministicIdsWithPrefix } from '@/helpers/crypto'

describe('getDeterministicIdsWithPrefix', () => {
  it('returns the same ids as getDeterministicId(prefix + suffix)', () => {
    const prefix = JSON.stringify({ models: 'x'.repeat(10000), name: 'héllo ✓ 😀' })
    const getId = getDeterministicIdsWithPrefix(prefix)
    for (const suffix of ['Post', 'Posttitle', 'ünï😀', '']) {
      expect(getId(suffix)).toBe(getDeterministicId(prefix + suffix))
    }
  })

  it('can be called repeatedly without changing earlier results', () => {
    const getId = getDeterministicIdsWithPrefix('schema')
    const first = getId('Post')
    getId('Comment')
    expect(getId('Post')).toBe(first)
  })
})
