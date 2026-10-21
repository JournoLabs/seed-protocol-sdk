import { describe, it, expect, vi, afterEach } from 'vitest'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { resolveMediaRef } from '@/helpers/mediaRef'

const TX_43 = 'a'.repeat(43)

describe('resolveMediaRef', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves url as direct', async () => {
    const r = await resolveMediaRef('https://example.com/x')
    expect(r).toEqual({
      status: 'ready',
      href: 'https://example.com/x',
      source: 'direct',
    })
  })

  it('returns unresolved for EAS attestation explorer URLs', async () => {
    const easUrl =
      'https://optimism-sepolia.easscan.org/attestation/view/0x302bafd11cebdd34606a974f19b7f576a6d74eb775c4b131c5fc9986afc467bb'
    const r = await resolveMediaRef(easUrl)
    expect(r.status).toBe('unresolved')
    if (r.status === 'unresolved') {
      expect(r.reason).toBe('non_media_url')
      expect(r.classification).toEqual({ kind: 'nonMediaUrl', href: easUrl })
    }
  })

  it('returns empty for empty string', async () => {
    expect(await resolveMediaRef('')).toEqual({ status: 'empty' })
  })

  it('returns unresolved for seedLocalId', async () => {
    const r = await resolveMediaRef('abcdefghij')
    expect(r.status).toBe('unresolved')
    if (r.status === 'unresolved') {
      expect(r.reason).toBe('seed_local_id_not_portable')
    }
  })

  it('uses gateway when local tx file missing', async () => {
    vi.spyOn(BaseFileManager, 'getFilesPath').mockReturnValue('/tmp/seed-images')
    vi.spyOn(BaseFileManager, 'pathExists').mockResolvedValue(false)
    const r = await resolveMediaRef(TX_43)
    expect(r.status).toBe('ready')
    if (r.status === 'ready') {
      expect(r.source).toBe('gateway')
      expect(r.href).toContain('/raw/')
      expect(r.href).toContain(TX_43)
    }
  })
})
