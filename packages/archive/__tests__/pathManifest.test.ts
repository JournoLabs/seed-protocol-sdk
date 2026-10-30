import { describe, it, expect } from 'vitest'
import {
  ArchiveError,
  buildPathManifest,
  createBag,
  digestHex,
  parsePathManifest,
  readBagFromManifest,
  validateBag,
  verifyArchive,
  type Bag,
} from '../src'

const encoder = new TextEncoder()
const asset = `assets/${'a'.repeat(64)}.png`

const makeBag = (index = true): Bag =>
  createBag({
    payload: [
      { path: index ? 'index.html' : 'body.html', bytes: encoder.encode(`<img src="${asset}">`) },
      { path: 'source/body.html', bytes: encoder.encode('<img src="ar://x">') },
      { path: asset, bytes: new Uint8Array([1, 2, 3]) },
      { path: 'item.json', bytes: encoder.encode('{}') },
    ],
    tagFiles: [{ path: 'metadata/dc.xml', bytes: encoder.encode('<dc/>') }],
    baggingDate: new Date('2026-10-30T00:00:00Z'),
  })

/** Content-addressed fake uploads: a transaction id per distinct file. */
const upload = (bag: Bag) => {
  const stored = new Map<string, Uint8Array>()
  const transactions: Record<string, string> = {}
  for (const file of bag.files) {
    const id = digestHex('sha256', file.bytes).slice(0, 43)
    stored.set(id, file.bytes)
    transactions[file.path] = id
  }
  return { stored, transactions }
}

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ArchiveError)
    return (error as ArchiveError).code
  }
  return undefined
}

describe('path manifest', () => {
  it('rebuilds a bag that validates from fetching every path', async () => {
    const bag = makeBag()
    const { stored, transactions } = upload(bag)
    const { bytes } = buildPathManifest(bag, transactions)

    const rebuilt = await readBagFromManifest(parsePathManifest(bytes), async (id) => stored.get(id))
    expect(validateBag(rebuilt)).toEqual({ valid: true, errors: [] })
    expect(rebuilt.files.map((f) => f.path).sort()).toEqual(bag.files.map((f) => f.path).sort())
    const expected = verifyArchive(bag).tagmanifestSha256!
    expect(verifyArchive(rebuilt, { expectedTagmanifestSha256: expected }).anchor.status).toBe('passed')
  })

  it('serves the index at the root with its relative links resolving', () => {
    const bag = makeBag()
    const { transactions } = upload(bag)
    const { manifest } = buildPathManifest(bag, transactions)
    expect(manifest).toMatchObject({ manifest: 'arweave/paths', version: '0.2.0', index: { path: 'data/index.html' } })
    expect(manifest.paths[asset]?.id).toBe(transactions[`data/${asset}`])
  })

  it('has no index or asset aliases without data/index.html', () => {
    const bag = makeBag(false)
    const { manifest } = buildPathManifest(bag, upload(bag).transactions)
    expect(manifest.index).toBeUndefined()
    expect(manifest.paths[asset]).toBeUndefined()
  })

  it('gives the same bytes whatever order the transactions come in', () => {
    const bag = makeBag()
    const { transactions } = upload(bag)
    const reversed = Object.fromEntries(Object.entries(transactions).reverse())
    expect(buildPathManifest(bag, reversed).bytes).toEqual(buildPathManifest(bag, transactions).bytes)
  })

  it('refuses a mapping that does not match the bag', () => {
    const bag = makeBag()
    const { transactions } = upload(bag)
    const { 'bagit.txt': _, ...incomplete } = transactions
    expect(code(() => buildPathManifest(bag, incomplete))).toBe('invalid_manifest')
    expect(code(() => buildPathManifest(bag, { ...transactions, 'data/extra': 'x'.repeat(43) }))).toBe('invalid_manifest')
    expect(code(() => buildPathManifest(bag, { ...transactions, 'bagit.txt': 'short' }))).toBe('invalid_manifest')
  })

  it('refuses a manifest with an unsafe path or the wrong shape', () => {
    const id = 'x'.repeat(43)
    const manifest = (paths: unknown, extra = {}) =>
      JSON.stringify({ manifest: 'arweave/paths', version: '0.2.0', paths, ...extra })
    expect(code(() => parsePathManifest(manifest({ '../evil': { id } })))).toBe('invalid_path')
    expect(code(() => parsePathManifest(manifest({ 'bagit.txt': { id: 'short' } })))).toBe('invalid_manifest')
    expect(code(() => parsePathManifest(manifest({}, { index: { path: 'data/index.html' } })))).toBe('invalid_manifest')
    expect(code(() => parsePathManifest('{"manifest":"arweave/paths","version":"0.1.0","paths":{}}'))).toBe('invalid_manifest')
    expect(code(() => parsePathManifest('not json'))).toBe('invalid_manifest')
  })

  it('throws missing_file for a transaction it cannot read', async () => {
    const bag = makeBag()
    const { manifest } = buildPathManifest(bag, upload(bag).transactions)
    await expect(readBagFromManifest(manifest, async () => undefined)).rejects.toMatchObject({ code: 'missing_file' })
  })
})
