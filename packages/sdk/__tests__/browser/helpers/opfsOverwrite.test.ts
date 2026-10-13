import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserFileManager } from '@/browser/helpers/FileManager'
import { TolerantWebAccessFS } from '@/browser/helpers/tolerantWebAccess'

/**
 * Overwriting an OPFS file must leave exactly the new bytes, also when they are fewer than before.
 * @zenfs/dom 1.2.9's WebAccessFS.write opens the file with keepExistingData and never truncates, so
 * `<p>saved</p>` written over `<p>legacy</p>` used to leave `<p>saved</p>>` on disk.
 *
 * Every case reads the result back through ZenFS, through a raw OPFS handle, and through a fresh
 * mount (which indexes sizes from OPFS).
 */

const testDir = `opfs-overwrite-${Math.random().toString(36).slice(2, 10)}`
const enc = new TextEncoder()

let fileManager: BrowserFileManager
let fs: any

const mount = (): TolerantWebAccessFS => fs.mounts.get('/')

/** What OPFS itself holds at `path`, bypassing ZenFS. */
async function readRaw(path: string): Promise<Uint8Array> {
  const segments = path.split('/').filter(Boolean)
  const fileName = segments.pop()!
  let dir = await navigator.storage.getDirectory()
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment)
  const file = await (await dir.getFileHandle(fileName)).getFile()
  return new Uint8Array(await file.arrayBuffer())
}

/** Waits for writes ZenFS queued from sync calls (writeFileSync) to reach OPFS. */
const flush = () => mount().sync()

async function expectContent(path: string, expected: Uint8Array | string) {
  const bytes = typeof expected === 'string' ? enc.encode(expected) : expected
  expect(await readRaw(path)).toEqual(bytes)
  expect((await fs.promises.stat(path)).size).toBe(bytes.byteLength)
  expect(new Uint8Array(await fs.promises.readFile(path))).toEqual(bytes)
  expect(new Uint8Array(fs.readFileSync(path))).toEqual(bytes)

  // A fresh mount indexes sizes and contents from OPFS.
  const fresh = new BrowserFileManager()
  await fresh.initializeFileSystem()
  fs = await fresh.getFs()
  expect(new Uint8Array(await fs.promises.readFile(path))).toEqual(bytes)
}

describe('overwriting OPFS files through ZenFS', () => {
  beforeAll(async () => {
    fileManager = new BrowserFileManager()
    await fileManager.initializeFileSystem()
    fs = await fileManager.getFs()
    await fs.promises.mkdir(`/${testDir}`, { recursive: true })
  })

  afterAll(async () => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(testDir, { recursive: true }).catch(() => {})
  })

  it('promises.writeFile: longer content, then shorter', async () => {
    const path = `/${testDir}/promises.html`
    await fs.promises.writeFile(path, '<p>legacy</p>')
    await fs.promises.writeFile(path, '<p>saved</p>')
    await expectContent(path, '<p>saved</p>')
  })

  it('promises.writeFile: content, then empty', async () => {
    const path = `/${testDir}/empty.txt`
    await fs.promises.writeFile(path, 'not empty for long')
    await fs.promises.writeFile(path, '')
    await expectContent(path, '')
  })

  it('promises.writeFile: binary content, then shorter binary content', async () => {
    const path = `/${testDir}/image.bin`
    const long = new Uint8Array(4096).map((_, i) => (i * 7) % 256)
    const short = new Uint8Array([0, 255, 0, 1, 2, 0xfe])
    await fs.promises.writeFile(path, long)
    await fs.promises.writeFile(path, short)
    await expectContent(path, short)
  })

  it('writeFileSync: longer content, then shorter', async () => {
    const path = `/${testDir}/sync.json`
    fs.writeFileSync(path, '{"title":"a longer title"}')
    await flush()
    fs.writeFileSync(path, '{"t":1}')
    await flush()
    await expectContent(path, '{"t":1}')
  })

  it('writeFileSync: content, then empty', async () => {
    const path = `/${testDir}/sync-empty.txt`
    fs.writeFileSync(path, 'something')
    await flush()
    fs.writeFileSync(path, '')
    await flush()
    await expectContent(path, '')
  })

  it('BrowserFileManager.saveFile: string, Blob and ArrayBuffer overwrites with shorter content', async () => {
    const path = `/${testDir}/saveFile.html`
    await fileManager.saveFile(path, '<p>legacy</p>')
    await fileManager.saveFile(path, '<p>saved</p>')
    // Read straight away: saveFile resolves once the write is done.
    expect(await fileManager.readFileAsString(path)).toBe('<p>saved</p>')
    expect(new TextDecoder().decode(await readRaw(path))).toBe('<p>saved</p>')

    await fileManager.saveFile(path, new Blob(['<p>b</p>']))
    expect(await fileManager.readFileAsString(path)).toBe('<p>b</p>')

    await fileManager.saveFile(path, new Uint8Array([1, 2]).buffer)
    expect(new Uint8Array(await (await fileManager.readFile(path)).arrayBuffer())).toEqual(new Uint8Array([1, 2]))
    await expectContent(path, new Uint8Array([1, 2]))
  })

  it('BrowserFileManager.saveFileSync: overwrite with shorter content', async () => {
    const path = `/${testDir}/saveFileSync.txt`
    fileManager.saveFileSync(path, 'a much longer first version')
    await flush()
    fileManager.saveFileSync(path, 'short')
    await flush()
    await expectContent(path, 'short')
  })

  it('promises.truncate shrinks the file on disk', async () => {
    const path = `/${testDir}/truncate.txt`
    await fs.promises.writeFile(path, 'hello world')
    await fs.promises.truncate(path, 5)
    await expectContent(path, 'hello')
  })

  it('keeps appends and positional writes working', async () => {
    const path = `/${testDir}/append.txt`
    await fs.promises.writeFile(path, 'hello')
    await fs.promises.appendFile(path, ' world')
    await expectContent(path, 'hello world')

    // Overwrite two bytes in the middle: the rest of the file stays.
    const handle = await fs.promises.open(path, 'r+')
    await handle.write(enc.encode('XY'), 0, 2, 2)
    await handle.close()
    await expectContent(path, 'heXYo world')

    // Chunked writes after opening with 'w' (as a write stream does) end with exactly the chunks.
    const writer = await fs.promises.open(path, 'w')
    await writer.write(enc.encode('ab'))
    await writer.write(enc.encode('cd'))
    await writer.close()
    await expectContent(path, 'abcd')
  })

  it('mounts that index a file written by another context see its new, shorter size', async () => {
    const path = `/${testDir}/external.txt`
    await fs.promises.writeFile(path, 'written through ZenFS, long')

    // Another context (a worker, another tab) replaces the file with shorter content.
    const segments = path.split('/').filter(Boolean)
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(segments[0]!)
    const writable = await (await dir.getFileHandle(segments[1]!)).createWritable()
    await writable.write('short')
    await writable.close()

    await fileManager.invalidateCachedPaths([path])
    fs = await fileManager.getFs()
    expect(await fs.promises.readFile(path, 'utf8')).toBe('short')
    // Reading doesn't write anything back.
    expect(new TextDecoder().decode(await readRaw(path))).toBe('short')
  })

  it('reading a file another context grew does not cut it to the size ZenFS last saw', async () => {
    const path = `/${testDir}/grown.txt`
    await fs.promises.writeFile(path, 'short')

    const segments = path.split('/').filter(Boolean)
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(segments[0]!)
    const writable = await (await dir.getFileHandle(segments[1]!)).createWritable()
    await writable.write('a longer version written past ZenFS')
    await writable.close()

    // Not invalidated: ZenFS still has the old size, and a read must not sync that size back.
    await fs.promises.readFile(path)
    fs.readFileSync(path)
    await flush()
    expect(new TextDecoder().decode(await readRaw(path))).toBe('a longer version written past ZenFS')
  })
})
