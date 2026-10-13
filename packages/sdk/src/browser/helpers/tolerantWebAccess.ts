import { constants, Inode } from '@zenfs/core'
import type { InodeLike } from '@zenfs/core'
import { join } from '@zenfs/core/path'
import { WebAccess, WebAccessFS } from '@zenfs/dom'
import type { WebAccessOptions } from '@zenfs/dom'
import debug from 'debug'
import { isSkippableOpfsEntryError } from './opfsErrors'

const logger = debug('seedSdk:browser:helpers:tolerantWebAccess')

/**
 * WebAccessFS mounts by walking all of OPFS and reading every file's size, and one unreadable
 * entry fails the whole mount. This variant skips such entries instead. A skipped file is still
 * listed by readdir, and WebAccessFS.stat() indexes it lazily on first use, once it is readable.
 *
 * It also makes overwrites with shorter content shrink the file (see `write` and `touch`).
 *
 * Overrides @zenfs/dom 1.2.9 / @zenfs/core 2.5.6 internals (`_loadHandles`, `_loadMetadata`,
 * `crossCopy`, `write`, `touch`, `get`, `_handles`, `_sync`, `index`); both packages are pinned to
 * exact versions, and tolerantWebAccess.test.ts / opfsOverwrite.test.ts cover the coupling.
 */
export class TolerantWebAccessFS extends WebAccessFS {
  constructor(root: FileSystemDirectoryHandle, disableHandleCache?: boolean) {
    super(root, disableHandleCache)
    // Reads would otherwise mark the file dirty (atime) and end in touch(), which shrinks the OPFS
    // file to the size it is given: with a stale size (a file another context grew) that would cut
    // data off. Without atime, touch() only follows writes, truncates, chmod and utimes.
    this.attributes.set('no_atime')
  }

  /**
   * WebAccessFS.write opens the file with `keepExistingData` and never truncates, so a whole-file
   * overwrite with shorter content (open 'w' sets the inode size to 0, then writes at 0) kept the old
   * tail on disk, and recorded the old size in the index. Here the file ends at ZenFS's logical size:
   * the larger of the inode's size (after any truncate) and the end of this write. Appends and writes
   * at an offset keep the rest of the file.
   */
  async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
    const inode = this.index.get(path)
    let handle: FileSystemHandle | undefined
    if (inode && (inode.mode & constants.S_IFMT) == constants.S_IFREG) {
      try {
        handle = await this.get('file', path)
      } catch {
        // Not in OPFS yet: WebAccessFS.write creates it, and a new file has no old tail.
      }
    }
    if (!inode || !handle) return super.write(path, buffer, offset)

    const data = copyIfShared(buffer)
    const size = Math.max(inode.size, offset + data.byteLength)
    // Replacing every byte: start from an empty file instead of copying the old one.
    const wholeFile = offset == 0 && data.byteLength >= size
    const writable = await (handle as FileSystemFileHandle).createWritable({ keepExistingData: !wholeFile })
    try {
      if (!wholeFile) await writable.truncate(size)
      await writable.write({ type: 'write', position: offset, data })
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => {})
      throw error
    }
    const { size: written, lastModified } = await (handle as FileSystemFileHandle).getFile()
    inode.update({ size: written, mtimeMs: lastModified })
    this.index.set(path, inode)
  }

  /**
   * ZenFS truncates by setting the inode's size and syncing it with touch() (FileHandle.truncate,
   * open 'w' through the sync API, whose data write reaches here before the new size does). Make
   * OPFS follow when that size is smaller than the file.
   */
  async touch(path: string, metadata: InodeLike): Promise<void> {
    await super.touch(path, metadata)
    const size = metadata.size
    const inode = this.index.get(path)
    if (typeof size != 'number' || !inode || (inode.mode & constants.S_IFMT) != constants.S_IFREG) return
    let handle: FileSystemFileHandle
    try {
      handle = (await this.get('file', path)) as FileSystemFileHandle
    } catch {
      return // Not in OPFS (yet): nothing to shrink.
    }
    if ((await handle.getFile()).size <= size) return
    const writable = await handle.createWritable({ keepExistingData: true })
    try {
      await writable.truncate(size)
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => {})
      throw error
    }
    const { size: truncated, lastModified } = await handle.getFile()
    inode.update({ size: truncated, mtimeMs: lastModified })
  }

  async _loadHandles(path: string, handle: FileSystemDirectoryHandle): Promise<void> {
    try {
      for await (const [key, child] of (handle as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        const p = join(path, key)
        this._handles.set(p, child)
        if (child.kind == 'directory') await this._loadHandles(p, child as FileSystemDirectoryHandle)
      }
    } catch (error) {
      // An unreadable root means nothing was walked; let initializeFileSystem retry the mount.
      if (!isSkippableOpfsEntryError(error) || path == '/') throw error
      // The directory went away (or became unreadable) mid-walk: forget it and anything under it.
      logger(`skipping directory ${path}: ${(error as DOMException).name}`)
      for (const p of [...this._handles.keys()]) {
        if (p == path || p.startsWith(path + '/')) this._handles.delete(p)
      }
    }
  }

  async _loadMetadata(metadataPath?: string): Promise<void> {
    if (metadataPath) return super._loadMetadata(metadataPath)

    this._handles.set('/', this.root)
    await this._loadHandles('/', this.root)

    for (const [path, handle] of [...this._handles]) {
      if (handle.kind == 'directory') {
        this.index.set(path, new Inode({ mode: 0o777 | constants.S_IFDIR, size: 0 }))
        continue
      }
      try {
        const { lastModified, size } = await (handle as FileSystemFileHandle).getFile()
        this.index.set(path, new Inode({ mode: 0o644 | constants.S_IFREG, size, mtimeMs: lastModified }))
      } catch (error) {
        if (!isSkippableOpfsEntryError(error)) throw error
        logger(`skipping file ${path}: ${(error as DOMException).name}`)
        // A removed file's handle would keep resolving to nothing; a locked one is still valid.
        if ((error as DOMException).name == 'NotFoundError') this._handles.delete(path)
      }
    }
  }

  /**
   * Forgets what the mount cached for `path` (size, handle, contents) and reads it again from OPFS.
   * For files written outside this ZenFS instance: by another tab, or by a worker writing to OPFS
   * directly. A file that's gone stays forgotten. The in-memory copy is only refreshed when its
   * directory is already cached; async reads re-index the file either way (WebAccessFS.stat).
   */
  async invalidate(path: string): Promise<void> {
    if (path == '/') return
    this.index.delete(path)
    this._handles.delete(path)
    try {
      this._sync.unlinkSync(path)
    } catch {
      // Not cached.
    }
    await this.crossCopy(path)
  }

  /**
   * The Async mixin's ready() then copies every file's contents into an in-memory cache, a second
   * walk that reads the same busy entries. Skip those too; the root still fails the mount.
   */
  async crossCopy(path: string): Promise<void> {
    const crossCopy = (WebAccessFS.prototype as unknown as AsyncCrossCopy).crossCopy
    if (path == '/') return crossCopy.call(this, path)
    try {
      await crossCopy.call(this, path)
    } catch (error) {
      if (!isSkippableOpfsEntryError(error) && !isErrnoChangedEntry(error)) throw error
      logger(`not caching ${path}: ${(error as Error).name}`)
      // Drop a half-copied entry so the cache doesn't serve an empty file in its place.
      try {
        this._sync.unlinkSync(path)
      } catch {
        try {
          this._sync.rmdirSync(path)
        } catch {
          // Nothing was copied.
        }
      }
    }
  }
}

/** OPFS writes take a plain ArrayBuffer view (WebAccessFS.write copies the same way). */
function copyIfShared(buffer: Uint8Array): Uint8Array<ArrayBuffer> {
  const backing = buffer.buffer as ArrayBufferLike & { resizable?: boolean; growable?: boolean }
  if (backing instanceof ArrayBuffer && !backing.resizable) return buffer as Uint8Array<ArrayBuffer>
  return new Uint8Array(buffer)
}

type AsyncCrossCopy = { crossCopy(this: TolerantWebAccessFS, path: string): Promise<void> }

/**
 * ZenFS converts most DOMExceptions to errno errors: an entry removed mid-walk becomes ENOENT, and
 * a file whose size changed since _loadMetadata (SQLite writing in another tab) fails read() with
 * an EIO size mismatch.
 */
function isErrnoChangedEntry(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  if (code === 'ENOENT') return true
  return code === 'EIO' && typeof message === 'string' && message.includes('mismatch in file data size')
}

/** Drop-in for `WebAccess` in `configureSingle({ backend, handle })`. */
export const TolerantWebAccess = {
  ...WebAccess,
  name: 'TolerantWebAccess',
  async create(options: WebAccessOptions): Promise<WebAccessFS> {
    const fs = new TolerantWebAccessFS(options.handle, options.disableHandleCache)
    await fs._loadMetadata(options.metadata)
    return fs
  },
}
