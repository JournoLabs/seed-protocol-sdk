import type { OPFSFile } from '../useOPFSFiles'

export type FileKind = 'image' | 'database' | 'json' | 'html' | 'text' | 'other'

export type SortKey = 'name' | 'modified' | 'size'

/** Detected type when available, otherwise File.type. */
export function effectiveType(file: OPFSFile): string {
  return file.detectedType ?? file.type
}

const DATABASE_NAME = /\.(db|sqlite|sqlite3)(-journal|-wal|-shm)?$/i

export function fileKind(file: OPFSFile): FileKind {
  const type = effectiveType(file)
  if (type.startsWith('image/')) return 'image'
  if (type === 'application/vnd.sqlite3' || DATABASE_NAME.test(file.name)) return 'database'
  if (type === 'application/json' || /\.json$/i.test(file.name)) return 'json'
  if (type === 'text/html' || /\.html?$/i.test(file.name)) return 'html'
  if (type.startsWith('text/')) return 'text'
  return 'other'
}

/** Short label for a file's format: its extension, or the detected subtype when there is none. */
export function formatLabel(file: OPFSFile): string {
  const ext = /\.([a-z0-9-]{1,12})$/i.exec(file.name)?.[1]
  if (ext) return ext.toLowerCase()
  const type = effectiveType(file)
  if (type === 'application/octet-stream') return 'bin'
  return type.split('/')[1]?.replace(/^vnd\./, '') ?? 'bin'
}

/** A resized copy the SDK writes to `…/images/<width>/<base>.webp`. */
export interface ImageVariant {
  file: OPFSFile
  width: number
}

/** A row in the manager: a file plus, for originals, its resized copies. */
export interface FileEntry {
  file: OPFSFile
  /** Resized copies, narrowest first. Empty unless variants are grouped. */
  variants: ImageVariant[]
  /** Size of the file plus its variants. */
  totalSize: number
}

const VARIANT_PATH = /^(.*\/)?images\/(\d+)\/([^/]+)\.webp$/
const ORIGINAL_PATH = /^(.*\/)?images\/([^/]+)$/

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

export function parseImageVariant(path: string): { key: string; width: number } | null {
  const m = VARIANT_PATH.exec(path)
  if (!m) return null
  return { key: `${m[1] ?? ''}images/${m[3]}`, width: Number(m[2]) }
}

function originalKey(path: string): string | null {
  const m = ORIGINAL_PATH.exec(path)
  return m ? `${m[1] ?? ''}images/${stripExtension(m[2])}` : null
}

const toEntry = (file: OPFSFile): FileEntry => ({ file, variants: [], totalSize: file.size })

/**
 * Turn the flat file list into entries. With `groupVariants`, resized copies are
 * attached to their original image and removed from the list. Copies whose original
 * is missing stay in the list on their own.
 */
export function buildEntries(files: OPFSFile[], groupVariants: boolean): FileEntry[] {
  if (!groupVariants) return files.map(toEntry)

  const originals = new Map<string, FileEntry>()
  const entries: FileEntry[] = []
  const variants: Array<{ file: OPFSFile; key: string; width: number }> = []

  for (const file of files) {
    const variant = parseImageVariant(file.path)
    if (variant) {
      variants.push({ file, ...variant })
      continue
    }
    const entry = toEntry(file)
    entries.push(entry)
    const key = originalKey(file.path)
    if (key && fileKind(file) === 'image') originals.set(key, entry)
  }

  for (const v of variants) {
    const original = originals.get(v.key)
    if (original) {
      original.variants.push({ file: v.file, width: v.width })
      original.totalSize += v.file.size
    } else {
      entries.push(toEntry(v.file))
    }
  }
  for (const entry of originals.values()) entry.variants.sort((a, b) => a.width - b.width)
  return entries
}

export interface FolderSummary {
  name: string
  path: string
  fileCount: number
  size: number
}

export interface DirectoryListing {
  folders: FolderSummary[]
  entries: FileEntry[]
}

const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

/**
 * List the folders and files directly inside `cwd`. With a search query, returns
 * every matching file at any depth below `cwd` and no folders.
 */
export function listDirectory(
  all: FileEntry[],
  cwd: string,
  options: { query?: string; sort?: SortKey } = {},
): DirectoryListing {
  const prefix = cwd ? `${cwd}/` : ''
  const inside = all.filter((e) => e.file.path.startsWith(prefix))
  const query = options.query?.trim().toLowerCase()

  if (query) {
    const matches = inside.filter((e) => e.file.path.slice(prefix.length).toLowerCase().includes(query))
    return { folders: [], entries: sortEntries(matches, options.sort) }
  }

  const folders = new Map<string, FolderSummary>()
  const entries: FileEntry[] = []
  for (const entry of inside) {
    const rest = entry.file.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      entries.push(entry)
      continue
    }
    const name = rest.slice(0, slash)
    const folder = folders.get(name) ?? { name, path: joinPath(cwd, name), fileCount: 0, size: 0 }
    folder.fileCount += 1
    folder.size += entry.totalSize
    folders.set(name, folder)
  }

  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entries: sortEntries(entries, options.sort),
  }
}

export function sortEntries(entries: FileEntry[], sort: SortKey = 'name'): FileEntry[] {
  const compare: Record<SortKey, (a: FileEntry, b: FileEntry) => number> = {
    name: (a, b) => a.file.name.localeCompare(b.file.name),
    modified: (a, b) => b.file.lastModified - a.file.lastModified,
    size: (a, b) => b.totalSize - a.totalSize,
  }
  return [...entries].sort(compare[sort])
}

/** Bytes per kind across all files, for the storage meter. */
export function sizeByKind(files: OPFSFile[]): Record<FileKind, number> {
  const totals: Record<FileKind, number> = { image: 0, database: 0, json: 0, html: 0, text: 0, other: 0 }
  for (const f of files) totals[fileKind(f)] += f.size
  return totals
}

/** Default deleteWarning: flags the Seed client's SQLite database. */
export function defaultDeleteWarning(files: OPFSFile[]): string | null {
  const db = files.find((f) => /(^|\/)db\/seed\.db$/.test(f.path))
  if (!db) return null
  return 'This includes the Seed database. The app loses its local items and drafts, and anything not yet published is gone. Reload the app afterwards.'
}
