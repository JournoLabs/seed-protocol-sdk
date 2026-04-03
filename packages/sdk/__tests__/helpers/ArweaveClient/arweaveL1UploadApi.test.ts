import { describe, expect, it } from 'vitest'
import { isArweaveL1AnchoringComplete } from '@/helpers/ArweaveClient/arweaveL1UploadApi'

describe('isArweaveL1AnchoringComplete', () => {
  it('returns true when meetsMinConfirmations is true', () => {
    expect(
      isArweaveL1AnchoringComplete({
        l1: { meetsMinConfirmations: true, confirmed: false },
      }),
    ).toBe(true)
  })

  it('returns true when confirmed is true', () => {
    expect(
      isArweaveL1AnchoringComplete({
        l1: { confirmed: true, meetsMinConfirmations: false },
      }),
    ).toBe(true)
  })

  it('returns false when l1 is missing or incomplete', () => {
    expect(isArweaveL1AnchoringComplete({})).toBe(false)
    expect(
      isArweaveL1AnchoringComplete({
        l1: { meetsMinConfirmations: false, confirmed: false },
      }),
    ).toBe(false)
  })
})
