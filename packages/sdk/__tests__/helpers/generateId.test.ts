import { describe, expect, it, vi } from 'vitest'

const draws = vi.hoisted(() => ['0xYVM3w1mf', '0x00000000', 'aB3dE5gH7j'])
vi.mock('nanoid', () => ({ customAlphabet: () => () => draws.shift()! }))

import { generateId } from '@/helpers/generateId'

describe('generateId', () => {
  it('never returns an id that starts with 0x', () => {
    // A local id that looks like the start of an EAS uid was published as one (CI run 38092037319)
    expect(generateId()).toBe('aB3dE5gH7j')
  })
})
