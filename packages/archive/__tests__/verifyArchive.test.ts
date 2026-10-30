import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBag, getBagFile, verifyArchive, verifyInstructions, type Bag } from '../src'
import { writeBagDirectory } from '../src/node'

const encoder = new TextEncoder()
const VERIFY = verifyInstructions({ seedUid: '0xseed', versionUid: '0xversion', reproducible: true })

const makeBag = (body = 'hello'): Bag =>
  createBag({
    payload: [{ path: 'index.html', bytes: encoder.encode(body) }],
    tagFiles: [{ path: 'VERIFY.txt', bytes: encoder.encode(VERIFY) }],
    info: [['Seed-Uid', '0xseed']],
    baggingDate: new Date('2026-10-30T00:00:00Z'),
  })

const replaced = (bag: Bag, file: string, body: string): Bag => ({
  files: bag.files.map((f) => (f.path === file ? { ...f, bytes: encoder.encode(body) } : f)),
})

describe('verifyArchive', () => {
  it('passes fixity and leaves the anchor unchecked with no outside hash', () => {
    const result = verifyArchive(makeBag())
    expect(result.fixity).toMatchObject({ status: 'passed', errors: [] })
    expect(result.anchor.status).toBe('not_checked')
    expect(result.tagmanifestSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('fails fixity for a changed file', () => {
    const result = verifyArchive(replaced(makeBag(), 'data/index.html', 'tampered'))
    expect(result.fixity.status).toBe('failed')
    expect(result.fixity.errors.join()).toContain('data/index.html')
  })

  it('fails fixity for a bag with no tag manifest', () => {
    const bag = makeBag()
    const result = verifyArchive({ files: bag.files.filter((f) => f.path !== 'tagmanifest-sha256.txt') })
    expect(result.fixity.status).toBe('failed')
    expect(result.tagmanifestSha256).toBeUndefined()
  })

  it('catches a bag rebuilt with new manifests only through the outside hash', () => {
    const expected = verifyArchive(makeBag()).tagmanifestSha256!
    const forged = makeBag('tampered')
    const result = verifyArchive(forged, { expectedTagmanifestSha256: expected })
    expect(result.fixity.status).toBe('passed')
    expect(result.anchor.status).toBe('failed')
  })

  it('accepts the outside hash with 0x and in upper case', () => {
    const expected = verifyArchive(makeBag()).tagmanifestSha256!
    const result = verifyArchive(makeBag(), { expectedTagmanifestSha256: `0x${expected.toUpperCase()}` })
    expect(result.anchor.status).toBe('passed')
  })

  it('gives commands in VERIFY.txt that pass on a good bag and fail on a changed one', async () => {
    const shasum = spawnSync('shasum', ['--version'])
    if (shasum.error) return
    const dir = await mkdtemp(path.join(tmpdir(), 'verify-archive-'))
    try {
      const good = path.join(dir, 'good')
      await writeBagDirectory(makeBag(), good)
      const text = new TextDecoder().decode(getBagFile(makeBag(), 'VERIFY.txt')!.bytes)
      const commands = [...text.matchAll(/^ {2}shasum (.+ -c .+)$/gm)].map((m) => m[1]!.split(' '))
      expect(commands).toHaveLength(2)
      for (const args of commands) execFileSync('shasum', args, { cwd: good, stdio: 'pipe' })

      const bad = path.join(dir, 'bad')
      await writeBagDirectory(replaced(makeBag(), 'data/index.html', 'tampered'), bad)
      expect(spawnSync('shasum', commands[1]!, { cwd: bad }).status).not.toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
