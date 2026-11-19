import { describe, expect, it } from 'vitest'
import * as mapping from '../src/index'

// Batch 17 item 3: the 0.8.2 CHANGELOG names resolveTargetLookup as new, but the entry left it out.
describe('@seedprotocol/mapping exports', () => {
  it('exports resolveTargetLookup', () => {
    expect(typeof (mapping as Record<string, unknown>).resolveTargetLookup).toBe('function')
  })
})
