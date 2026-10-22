import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArchiveError, createBag, digestHex, getBagFile, validateBag, type Bag } from '../src'
import { readBagDirectory, writeBagDirectory } from '../src/node'
import { bagitPyRequired, findBagitPy, runBagitPy } from './bagitPy'

const text = (s: string) => new TextEncoder().encode(s)
const read = (bag: Bag, p: string) => new TextDecoder().decode(getBagFile(bag, p)?.bytes)

const sampleBag = () =>
  createBag({
    payload: [
      { path: 'index.html', bytes: text('<article class="h-entry"><h1 class="p-name">Hi</h1></article>') },
      { path: 'assets/a b.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]) },
      { path: 'source/café.html', bytes: text('<p>café</p>') },
    ],
    tagFiles: [{ path: 'metadata/dc.xml', bytes: text('<dc/>') }],
    info: [
      ['Source-Organization', 'JournoLabs'],
      ['Internal-Sender-Description', 'line one\nline two'],
    ],
    baggingDate: new Date('2026-10-22T12:00:00Z'),
  })

describe('createBag', () => {
  it('writes the BagIt 1.0 tag files and SHA-256/SHA-512 manifests', () => {
    const bag = sampleBag()
    expect(bag.files.map((f) => f.path)).toEqual([
      'bagit.txt',
      'bag-info.txt',
      'manifest-sha256.txt',
      'manifest-sha512.txt',
      'metadata/dc.xml',
      'tagmanifest-sha256.txt',
      'tagmanifest-sha512.txt',
      'data/assets/a b.png',
      'data/index.html',
      'data/source/café.html',
    ])
    expect(read(bag, 'bagit.txt')).toBe('BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n')
    const info = read(bag, 'bag-info.txt')
    expect(info).toContain('Internal-Sender-Description: line one\n  line two\n')
    expect(info).toContain('Bagging-Date: 2026-10-22\n')
    const payloadBytes = bag.files.filter((f) => f.path.startsWith('data/')).reduce((n, f) => n + f.bytes.byteLength, 0)
    expect(info).toContain(`Payload-Oxum: ${payloadBytes}.3\n`)

    const png = getBagFile(bag, 'data/assets/a b.png')!
    expect(read(bag, 'manifest-sha256.txt')).toContain(`${digestHex('sha256', png.bytes)}  data/assets/a b.png\n`)
    expect(read(bag, 'tagmanifest-sha512.txt')).toContain('  metadata/dc.xml\n')
    expect(read(bag, 'tagmanifest-sha256.txt')).not.toContain('tagmanifest')
  })

  it.each([
    ['../x', 'segment'],
    ['/x', 'absolute'],
    ['a\\b', 'backslash'],
    ['a//b', 'segment'],
    ['line\nbreak', 'control'],
    ['cafe\u0301.html', 'NFC'],
    ['100%.html', '"%"'],
  ])('refuses the payload path %j', (p, reason) => {
    expect(() => createBag({ payload: [{ path: p, bytes: text('x') }] })).toThrow(reason)
  })

  it('refuses paths that differ only in letter case, and reserved tag file names', () => {
    expect(() =>
      createBag({ payload: [{ path: 'A.txt', bytes: text('1') }, { path: 'a.txt', bytes: text('2') }] }),
    ).toThrow(ArchiveError)
    expect(() => createBag({ payload: [], tagFiles: [{ path: 'manifest-md5.txt', bytes: text('') }] })).toThrow(
      "can't be supplied",
    )
    expect(() => createBag({ payload: [], tagFiles: [{ path: 'data/x', bytes: text('') }] })).toThrow("can't be supplied")
  })
})

describe('validateBag', () => {
  it('accepts a bag createBag wrote', () => {
    expect(validateBag(sampleBag())).toEqual({ valid: true, errors: [] })
  })

  it('reports a changed payload file, an unlisted file and a wrong Payload-Oxum', () => {
    const bag = sampleBag()
    const html = getBagFile(bag, 'data/index.html')!
    html.bytes = text('<p>tampered</p>')
    bag.files.push({ path: 'data/extra.txt', bytes: text('x') })
    const { valid, errors } = validateBag(bag)
    expect(valid).toBe(false)
    expect(errors).toContain('manifest-sha256.txt: data/index.html does not match its sha256 checksum')
    expect(errors).toContain('manifest-sha512.txt: payload file data/extra.txt is not listed')
    expect(errors.some((e) => e.startsWith('bag-info.txt: Payload-Oxum'))).toBe(true)
  })

  it('reports a changed tag file through the tag manifests', () => {
    const bag = sampleBag()
    getBagFile(bag, 'metadata/dc.xml')!.bytes = text('<dc>changed</dc>')
    expect(validateBag(bag).errors).toContain('tagmanifest-sha256.txt: metadata/dc.xml does not match its sha256 checksum')
  })
})

describe('bag directories', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })
  const tempDir = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'seed-archive-'))
    dirs.push(dir)
    return dir
  }

  it('round-trips a bag through a directory', async () => {
    const dir = path.join(await tempDir(), 'bag')
    const bag = sampleBag()
    await writeBagDirectory(bag, dir)
    const back = await readBagDirectory(dir)
    expect(validateBag(back).valid).toBe(true)
    expect(back.files.map((f) => f.path).sort()).toEqual(bag.files.map((f) => f.path).sort())
  })

  it('refuses to write into a non-empty directory', async () => {
    const dir = await tempDir()
    await writeFile(path.join(dir, 'stray.txt'), 'x')
    await expect(writeBagDirectory(sampleBag(), dir)).rejects.toThrow('is not empty')
  })

  const bagitPy = findBagitPy()
  it.runIf(bagitPy || bagitPyRequired())('passes bagit.py --validate', async () => {
    expect(bagitPy, 'bagit.py is not installed (pipx install bagit==1.9.0)').toBeDefined()
    const dir = path.join(await tempDir(), 'bag')
    await writeBagDirectory(sampleBag(), dir)
    const result = runBagitPy(bagitPy!, dir)
    expect(result.output).toContain('is valid')
    expect(result.status).toBe(0)
  })

  it.runIf(bagitPy || bagitPyRequired())('bagit.py rejects a tampered bag', async () => {
    const dir = path.join(await tempDir(), 'bag')
    await writeBagDirectory(sampleBag(), dir)
    await writeFile(path.join(dir, 'data', 'index.html'), '<p>tampered</p>')
    expect(runBagitPy(bagitPy!, dir).status).not.toBe(0)
  })
})
