import { describe, expect, it } from 'vitest'
import { checkIfNoneMatch } from '../src/utils/etag'

describe('checkIfNoneMatch', () => {
  it('matches a weak If-None-Match ETag against the strong one it came from', () => {
    expect(checkIfNoneMatch('W/"abc"', '"abc"')).toBe(true)
    expect(checkIfNoneMatch('"x", W/"abc"', '"abc"')).toBe(true)
    expect(checkIfNoneMatch('W/"abd"', '"abc"')).toBe(false)
  })
})
