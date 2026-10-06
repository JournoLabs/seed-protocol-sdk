import { describe, it, expect } from 'vitest'
import type { OPFSFile } from '../src/useOPFSFiles'
import {
  buildEntries,
  defaultDeleteWarning,
  fileKind,
  formatLabel,
  listDirectory,
} from '../src/OPFSFilesManager/fileModel'
import { formatFileSize, truncateMiddle } from '../src/OPFSFilesManager/format'
import { crc32, createZip } from '../src/OPFSFilesManager/zip'
import { sniffMimeType } from '../src/opfsPaths'

const file = (path: string, size = 100, extra: Partial<OPFSFile> = {}): OPFSFile => ({
  name: path.split('/').pop()!,
  path,
  size,
  type: /\.jpe?g$/.test(path)
    ? 'image/jpeg'
    : /\.webp$/.test(path)
      ? 'image/webp'
      : /\.json$/.test(path)
        ? 'application/json'
        : 'application/octet-stream',
  lastModified: 1_700_000_000_000,
  ...extra,
})

const TX = 'Xq7m3kR2vT9pLw4nB8cZ1yH6dF0sJ5gAeUoKiQrMtx'
const FILES = [
  file('app-files/db/seed.db', 4000, { detectedType: 'application/vnd.sqlite3' }),
  file('app-files/files/images/ridge.jpg', 1000),
  file('app-files/files/images/480/ridge.webp', 40),
  file('app-files/files/images/1024/ridge.webp', 90),
  file(`app-files/files/images/${TX}`, 500, { detectedType: 'image/png' }),
  file(`app-files/files/images/480/${TX}.webp`, 30),
  file('app-files/files/images/480/orphan.webp', 20),
  file('app-files/files/json/abc.json', 10),
]

describe('buildEntries', () => {
  it('groups resized copies under their original, narrowest first', () => {
    const entries = buildEntries(FILES, true)
    const ridge = entries.find((e) => e.file.name === 'ridge.jpg')!
    expect(ridge.variants.map((v) => v.width)).toEqual([480, 1024])
    expect(ridge.totalSize).toBe(1130)
  })

  it('matches extensionless transaction-ID originals', () => {
    const entries = buildEntries(FILES, true)
    const tx = entries.find((e) => e.file.name === TX)!
    expect(tx.variants).toHaveLength(1)
  })

  it('keeps copies whose original is missing', () => {
    const paths = buildEntries(FILES, true).map((e) => e.file.path)
    expect(paths).toContain('app-files/files/images/480/orphan.webp')
    expect(paths).not.toContain('app-files/files/images/480/ridge.webp')
  })

  it('leaves every file separate when grouping is off', () => {
    expect(buildEntries(FILES, false)).toHaveLength(FILES.length)
  })
})

describe('listDirectory', () => {
  const entries = buildEntries(FILES, true)

  it('lists direct folders with counts and sizes', () => {
    const { folders, entries: here } = listDirectory(entries, 'app-files')
    expect(here).toEqual([])
    expect(folders.map((f) => [f.name, f.fileCount])).toEqual([
      ['db', 1],
      ['files', 4],
    ])
  })

  it('hides size folders that only held grouped copies', () => {
    const { folders } = listDirectory(entries, 'app-files/files/images')
    expect(folders.map((f) => f.name)).toEqual(['480'])
  })

  it('searches every folder below the current one', () => {
    const { folders, entries: hits } = listDirectory(entries, 'app-files', { query: 'RIDGE' })
    expect(folders).toEqual([])
    expect(hits.map((e) => e.file.name)).toEqual(['ridge.jpg'])
  })

  it('sorts by total size, largest first', () => {
    const { entries: here } = listDirectory(entries, 'app-files/files/images', { sort: 'size' })
    expect(here.map((e) => e.file.name)).toEqual(['ridge.jpg', TX])
  })
})

describe('file kinds', () => {
  it('uses the detected type when File.type is unknown', () => {
    expect(fileKind(FILES[0])).toBe('database')
    expect(fileKind(FILES[4])).toBe('image')
    expect(formatLabel(FILES[4])).toBe('png')
    expect(formatLabel(FILES[1])).toBe('jpg')
  })

  it('warns about the Seed database by default', () => {
    expect(defaultDeleteWarning([FILES[0]])).toMatch(/Seed database/)
    expect(defaultDeleteWarning([FILES[1]])).toBeNull()
  })
})

describe('sniffMimeType', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)])
  const text = (s: string) => new Uint8Array([...new TextEncoder().encode(s), ...new Array(16).fill(0)])

  it('recognizes common signatures', () => {
    expect(sniffMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffMimeType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png')
    expect(sniffMimeType(text('RIFF\0\0\0\0WEBP'))).toBe('image/webp')
    expect(sniffMimeType(text('SQLite format 3\0'))).toBe('application/vnd.sqlite3')
    expect(sniffMimeType(text('{"a":1}'))).toBeUndefined()
  })
})

describe('format', () => {
  it('formats sizes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(812)).toBe('812 B')
    expect(formatFileSize(4300)).toBe('4.2 KB')
    expect(formatFileSize(39_845_888)).toBe('38 MB')
  })

  it('truncates from the middle', () => {
    expect(truncateMiddle(TX, 11)).toBe('Xq7m3…QrMtx')
    expect(truncateMiddle('short.jpg', 20)).toBe('short.jpg')
  })
})

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686)
  })

  it('writes a valid store-only archive', async () => {
    const zip = await createZip([
      { name: 'a.txt', data: new Blob(['hello']) },
      { name: 'dir/b.json', data: new Blob(['{}']) },
    ])
    const view = new DataView(await zip.arrayBuffer())
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const eocd = zip.size - 22
    expect(view.getUint32(eocd, true)).toBe(0x06054b50)
    expect(view.getUint16(eocd + 10, true)).toBe(2)
    const centralOffset = view.getUint32(eocd + 16, true)
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50)
    expect(view.getUint32(centralOffset + 16, true)).toBe(0x3610a686)
    expect(zip.type).toBe('application/zip')
  })
})
