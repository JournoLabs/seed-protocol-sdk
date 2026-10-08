/**
 * Shared OPFS path helpers. Paths are '/'-separated and relative to the OPFS root
 * (e.g. 'app-files/files/images/photo.jpg').
 */

function splitPath(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error(`Invalid OPFS path: "${path}"`)
  return parts
}

/** Walk to the directory handle at `path`. */
export async function resolveDirectoryHandle(
  path: string,
  root?: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  let handle = root ?? (await navigator.storage.getDirectory())
  for (const part of path.split('/').filter(Boolean)) {
    handle = await handle.getDirectoryHandle(part)
  }
  return handle
}

/** Resolve the parent directory handle and the entry name for `path`. */
async function resolveParent(
  path: string,
  root?: FileSystemDirectoryHandle,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = splitPath(path)
  const name = parts.pop()!
  const dir = await resolveDirectoryHandle(parts.join('/'), root)
  return { dir, name }
}

export async function resolveFileHandle(
  path: string,
  root?: FileSystemDirectoryHandle,
): Promise<FileSystemFileHandle> {
  const { dir, name } = await resolveParent(path, root)
  return dir.getFileHandle(name)
}

/** Read the file at `path` as a File (which is a Blob). */
export async function getOPFSFile(path: string, root?: FileSystemDirectoryHandle): Promise<File> {
  const handle = await resolveFileHandle(path, root)
  return handle.getFile()
}

export async function deleteOPFSEntry(path: string, root?: FileSystemDirectoryHandle): Promise<void> {
  const { dir, name } = await resolveParent(path, root)
  await dir.removeEntry(name)
}

async function pruneEmptyDirectory(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  const dir = await parent.getDirectoryHandle(name)
  const children: [string, FileSystemHandle][] = []
  for await (const child of dir.entries()) children.push(child)
  let empty = true
  for (const [childName, handle] of children) {
    if (handle.kind === 'file' || !(await pruneEmptyDirectory(dir, childName))) empty = false
  }
  if (empty) await parent.removeEntry(name)
  return empty
}

/**
 * Remove the folder at `path` and any folders inside it that hold no files. Folders that
 * still hold files stay. Resolves true when `path` itself was removed (or was already gone).
 */
export async function removeEmptyOPFSDirectories(path: string, root?: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const { dir, name } = await resolveParent(path, root)
    return await pruneEmptyDirectory(dir, name)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return true
    throw err
  }
}

/** True when this browser exposes the Origin Private File System. */
export function isOPFSSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

const SIGNATURES: Array<{ type: string; test: (b: Uint8Array) => boolean }> = [
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { type: 'image/gif', test: (b) => ascii(b, 0, 4) === 'GIF8' },
  { type: 'image/webp', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  {
    type: 'image/avif',
    test: (b) => ascii(b, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 12)),
  },
  { type: 'application/vnd.sqlite3', test: (b) => ascii(b, 0, 15) === 'SQLite format 3' },
  { type: 'application/pdf', test: (b) => ascii(b, 0, 5) === '%PDF-' },
]

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

/** Identify a file type from its leading bytes (at least 16 bytes recommended). */
export function sniffMimeType(bytes: Uint8Array): string | undefined {
  return SIGNATURES.find((s) => s.test(bytes))?.type
}

/**
 * OPFS doesn't store MIME types, so File.type comes from the extension and is empty
 * for files saved under an Arweave transaction ID. Sniff those from their contents.
 */
export async function detectMimeType(file: Blob): Promise<string | undefined> {
  if (file.size === 0) return undefined
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  return sniffMimeType(head)
}
