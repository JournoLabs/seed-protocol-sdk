import { describe, it, expect } from 'vitest'
import { isEasAttestationExplorerUrl } from '../src/easAttestationUrl.js'

describe('isEasAttestationExplorerUrl', () => {
  it('detects EAS attestation explorer URLs', () => {
    expect(
      isEasAttestationExplorerUrl(
        'https://optimism-sepolia.easscan.org/attestation/view/0x302bafd11cebdd34606a974f19b7f576a6d74eb775c4b131c5fc9986afc467bb',
      ),
    ).toBe(true)
    expect(
      isEasAttestationExplorerUrl(
        'https://easscan.org/attestation/view/0xabc',
      ),
    ).toBe(true)
    expect(
      isEasAttestationExplorerUrl(
        'https://base.easscan.xyz/attestation/view/0xabc',
      ),
    ).toBe(true)
  })

  it('does not treat other HTTPS URLs as EAS explorer pages', () => {
    expect(isEasAttestationExplorerUrl('https://arweave.net/abc123')).toBe(false)
    expect(isEasAttestationExplorerUrl('https://ar.seedprotocol.io/abc123')).toBe(false)
    expect(isEasAttestationExplorerUrl('https://example.com/attestation/view/0xabc')).toBe(false)
  })
})
