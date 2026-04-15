import { describe, it, expect, vi, afterEach } from 'vitest'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import {
  classifyMediaRef,
  resolveMediaRef,
  normalizeFeedItemFields,
  getFeedItemStringField,
} from '@/helpers/mediaRef'

const TX_43 = 'a'.repeat(43)

describe('classifyMediaRef', () => {
  it('returns empty for blank', () => {
    expect(classifyMediaRef('')).toEqual({ kind: 'empty' })
    expect(classifyMediaRef('   ')).toEqual({ kind: 'empty' })
  })

  it('classifies http(s), blob, data URLs', () => {
    expect(classifyMediaRef('https://example.com/a.png')).toEqual({
      kind: 'url',
      href: 'https://example.com/a.png',
    })
    expect(classifyMediaRef('http://x/y')).toEqual({ kind: 'url', href: 'http://x/y' })
    expect(classifyMediaRef('blob:http://local/uuid')).toEqual({
      kind: 'url',
      href: 'blob:http://local/uuid',
    })
    expect(classifyMediaRef('data:image/png;base64,AAAA')).toEqual({
      kind: 'url',
      href: 'data:image/png;base64,AAAA',
    })
  })

  it('classifies 0x66 as seedUid', () => {
    const uid =
      '0x' + 'a'.repeat(64)
    expect(classifyMediaRef(uid)).toEqual({ kind: 'seedUid', uid })
  })

  it('classifies JSON relation with seedUid', () => {
    const uid = '0x' + 'b'.repeat(64)
    expect(classifyMediaRef(JSON.stringify({ seedUid: uid }))).toEqual({
      kind: 'seedUid',
      uid,
    })
  })

  it('classifies 43-char base64url as arweaveTxId', () => {
    expect(classifyMediaRef(TX_43)).toEqual({ kind: 'arweaveTxId', txId: TX_43 })
  })

  it('classifies local seed ref string', () => {
    const id = 'abcdefghij'
    expect(classifyMediaRef(id)).toEqual({ kind: 'seedLocalId', localId: id })
  })

  it('returns unknown for opaque strings', () => {
    const tooLongForLocalId = 'b'.repeat(22)
    expect(classifyMediaRef(tooLongForLocalId)).toEqual({
      kind: 'unknown',
      raw: tooLongForLocalId,
    })
  })

  it('respects treatAs overrides', () => {
    expect(classifyMediaRef('hello', { treatAs: 'url' })).toEqual({
      kind: 'url',
      href: 'hello',
    })
    expect(classifyMediaRef(TX_43, { treatAs: 'seedUid' })).toEqual({
      kind: 'unknown',
      raw: TX_43,
    })
    const uid = '0x' + 'c'.repeat(64)
    expect(classifyMediaRef(uid, { treatAs: 'seedUid' })).toEqual({ kind: 'seedUid', uid })
  })
})

describe('normalizeFeedItemFields', () => {
  it('maps manifest keys and classifies media roles', () => {
    const item = {
      featureImage: TX_43,
      body: '  <p>Hi</p>  ',
      title: '  T  ',
    }
    const manifest = {
      featureImage: { role: 'image' as const },
      body: { role: 'html' as const },
      title: { role: 'text' as const },
    }
    const n = normalizeFeedItemFields(item, manifest)
    expect(n.featureImage?.role).toBe('image')
    if (n.featureImage && n.featureImage.role === 'image') {
      expect(n.featureImage.classification).toEqual({ kind: 'arweaveTxId', txId: TX_43 })
    }
    expect(n.body).toEqual({ role: 'html', raw: '<p>Hi</p>' })
    expect(n.title).toEqual({ role: 'text', raw: 'T' })
  })

  it('reads snake_case when camelCase manifest key is used', () => {
    const item = { feature_image: TX_43 }
    const n = normalizeFeedItemFields(item, { featureImage: { role: 'image' } })
    expect(n.featureImage?.role).toBe('image')
  })
})

describe('getFeedItemStringField', () => {
  it('coalesces camel and snake keys', () => {
    expect(getFeedItemStringField({ feature_image: 'x' }, 'featureImage')).toBe('x')
    expect(getFeedItemStringField({ featureImage: 'y' }, 'feature_image')).toBe('y')
  })
})

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
