import { describe, it, expect } from 'vitest'
import { isUnderDotSeed } from '@/helpers/dotSeedPath'

describe('isUnderDotSeed', () => {
  it.each(['.seed', '.seed/', '.seed/files', './.seed/files', '.seed\\files'])('%s is under .seed', (p) => {
    expect(isUnderDotSeed(p)).toBe(true)
  })

  it.each(['.seed-alt/x', '.seedfoo', 'files/.seed', 'files', '../.seed'])('%s is not', (p) => {
    expect(isUnderDotSeed(p)).toBe(false)
  })
})
