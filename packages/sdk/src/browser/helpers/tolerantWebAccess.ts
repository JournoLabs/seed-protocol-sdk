import { constants, ErrnoError, Inode, vfs } from '@zenfs/core'
import type { CreationOptions, InodeLike } from '@zenfs/core'
import { dirname, join } from '@zenfs/core/path'
import { WebAccess, WebAccessFS } from '@zenfs/dom'
import type { WebAccessOptions } from '@zenfs/dom'
import debug from 'debug'
import { isSkippableOpfsEntryError } from './opfsErrors'

const logger = debug('seedSdk:browser:helpers:tolerantWebAccess')

/** kerium errno numbers (Errno isn't re-exported by @zenfs/core). */
const ENOENT = 2
const EIO = 5

/** The touch WebAccessFS inherits from ZenFS's Async mixin, under its own override. */
const asyncTouch: WebAccessFS['touch'] = Object.getPrototypeOf(WebAccessFS.prototype).touch

/** A truncate made through this mount that OPFS doesn't have yet. Compared by identity. */
type PendingTruncate = { readonly length: number }

/** An OPFS file as this mount last saw it. */
type OpfsVersion = { size: number; lastModified: number }

/**
 * WebAccessFS mounts by walking all of OPFS and reading every file's size, and one unreadable
 * entry fails the whole mount. This variant skips such entries instead. A skipped file is still
 * listed by readdir, and WebAccessFS.stat() indexes it lazily on first use, once it is readable.
 *
 * It also makes overwrites with shorter content shrink the file (see `write` and `touch`), without
 * cutting off bytes another context (a tab, a worker writing through a SyncAccessHandle) added to a
 * file this mount had indexed at a smaller size: OPFS only shrinks for a truncate made through this
 * mount, and stat() re-reads a file's size when OPFS changed since this mount last looked.
 *
 * Overrides @zenfs/dom 1.2.14 / @zenfs/core 2.7.7 internals (`_loadHandles`, `_loadMetadata`,
 * `crossCopy`, `stat`, `write`, `touch`, `remove`, `get`, `_handles`, `_sync`, `_isInitialized`,
 * `index`, and `vfs.Handle#truncate`/`truncateSync`, see `trackTruncates`); both packages are pinned
 * to exact versions, and tolerantWebAccess.test.ts / opfsOverwrite.test.ts cover the coupling.
 */
export class TolerantWebAccessFS extends WebAccessFS {
  /**
   * Truncates made through this mount that OPFS doesn't have yet, by path. ZenFS truncates by
   * lowering the inode's size and syncing it later, so only these may shrink the OPFS file: an
   * inode that is merely smaller than the file is a stale view of a file someone else grew.
   */
  private readonly _truncates = new Map<string, PendingTruncate>()

  /** Each OPFS file as this mount last saw it, to notice writes made elsewhere. */
  private readonly _seen = new Map<string, OpfsVersion>()

  /**
   * Called with each file path whose OPFS contents this mount changed (a write, a truncate, a
   * removal; a rename is both), once the change is in OPFS. BrowserFileManager uses it to tell other
   * tabs. Not called for what invalidate(), stat() or crossCopy() put in the in-memory copy: those
   * only read OPFS.
   */
  onOpfsChange?: (path: string) => void

  constructor(root: FileSystemDirectoryHandle, disableHandleCache?: boolean) {
    super(root, disableHandleCache)
    // Reads would otherwise mark the file dirty (atime) and end in touch() for every read. Without
    // atime, touch() only follows writes, truncates, chmod and utimes.
    this.attributes.set('no_atime')
  }

  /**
   * Called by vfs.Handle#truncate(Sync) for files on this mount (see `trackTruncates`). Returns an
   * undo for a truncate the handle then rejects.
   */
  _noteTruncate(path: string, length: number): () => void {
    const previous = this._truncates.get(path)
    // Truncated twice before a write: the bytes past the shorter length are gone either way.
    this._truncates.set(path, { length: Math.min(length, previous?.length ?? length) })
    return () => {
      if (previous) this._truncates.set(path, previous)
      else this._truncates.delete(path)
    }
  }

  /**
   * The sync API's in-memory copy (a StoreFS) truncates by setting the size alone and keeps the old
   * bytes, which a later write past that size then exposes in place of zeros. Cut them off there
   * too. Called by vfs.Handle#truncate(Sync) once the truncate went through.
   */
  _truncateCache(path: string, length: number): void {
    try {
      const cached = this._sync.statSync(path)
      if ((cached.mode & constants.S_IFMT) != constants.S_IFREG) return
      // Even when the size already matches: a sync handle's truncate() has synced it by now.
      const data = new Uint8Array(length) // Past the old size (truncate to extend): zeros.
      const kept = Math.min(length, cached.size)
      if (kept) this._sync.readSync(path, data.subarray(0, kept), 0, kept)
      this._sync.unlinkSync(path)
      this._sync.createFileSync(path, cached as unknown as CreationOptions)
      if (length) this._sync.writeSync(path, data, 0)
      cached.size = length
      this._sync.touchSync(path, cached)
    } catch (error) {
      logger(`could not truncate the cached copy of ${path}: ${(error as Error).name}`)
    }
  }

  private _takeTruncate(path: string, pending: PendingTruncate | undefined): void {
    // A truncate recorded while this write or sync was under way is left for the next one.
    if (pending && this._truncates.get(path) === pending) this._truncates.delete(path)
  }

  private _changed(path: string): void {
    try {
      this.onOpfsChange?.(path)
    } catch (error) {
      logger(`change listener failed for ${path}`, error)
    }
  }

  private _remember(path: string, file: File): void {
    this._seen.set(path, { size: file.size, lastModified: file.lastModified })
  }

  /** Another context changed the file: the next stat() refreshes the sync API's in-memory copy. */
  private _markChangedElsewhere(path: string): void {
    this._seen.set(path, { size: -1, lastModified: -1 })
  }

  /**
   * The index holds each file's size from when this mount last looked, and another context may
   * have written the file since. Re-read it from OPFS, so opening a file (an append goes to its
   * size) and reading it see the true file, and refresh the in-memory copy behind the sync API when
   * the file changed. Costs one getFile() per stat of a regular file; contents are only read when
   * the file changed.
   */
  async stat(path: string): Promise<Inode> {
    const indexed = this.index.has(path)
    let inode: Inode
    try {
      inode = (await super.stat(path)) as Inode
    } catch (error) {
      // WebAccessFS.stat reads a file it hasn't indexed from its handle and lets OPFS's DOMException
      // through when the file was removed in between (another context, or an unlink racing a
      // readdir). ZenFS expects an errno error: readdir skips ENOENT entries, and it appends to the
      // message of other errors, which a DOMException's getter-only message refuses.
      if (!(error instanceof DOMException)) throw error
      const converted = new ErrnoError(error.name == 'NotFoundError' ? ENOENT : EIO, error.message)
      converted.path = path
      converted.cause = error
      throw converted
    }
    // While mounting, sizes were just read and crossCopy stats every file.
    if (!(this as unknown as AsyncState)._isInitialized) return inode
    if (!indexed) await this._cacheIndexed(path, inode)
    if ((inode.mode & constants.S_IFMT) != constants.S_IFREG) return inode
    // This mount truncated the file and OPFS doesn't have it yet: the inode's size is the truth.
    if (this._truncates.has(path)) return inode

    let file: File
    try {
      file = await ((await this.get('file', path)) as FileSystemFileHandle).getFile()
    } catch {
      return inode // Gone or busy: keep what the index knows.
    }
    const seen = this._seen.get(path)
    if (seen && seen.size == file.size && seen.lastModified == file.lastModified) return inode
    this._remember(path, file)
    // First look at a file this mount just indexed (WebAccessFS.stat, invalidate): nothing to fix.
    if (!seen && inode.size == file.size) return inode
    logger(`${path} changed outside this mount (${inode.size} -> ${file.size} bytes)`)
    inode.update({ size: file.size, mtimeMs: file.lastModified })
    this.index.set(path, inode)
    await this._recache(path, inode, file)
    return inode
  }

  /**
   * Adds an entry WebAccessFS.stat() just indexed from OPFS (made by another context after this
   * mount loaded: a tab, SQLocal's worker creating `db/`) to the in-memory copy behind the sync API.
   * ZenFS mirrors every write and create into that copy and fails the call when the entry or its
   * directory is missing there.
   */
  private async _cacheIndexed(path: string, inode: Inode): Promise<void> {
    try {
      this._sync.statSync(path)
      return
    } catch {
      // Not cached yet.
    }
    await this._cacheParents(path)
    try {
      if ((inode.mode & constants.S_IFMT) == constants.S_IFDIR) {
        this._sync.mkdirSync(path, inode as unknown as CreationOptions)
        this._sync.touchSync(path, inode)
      } else {
        await this.crossCopy(path)
      }
    } catch (error) {
      logger(`could not cache ${path}: ${(error as Error).name}`)
    }
  }

  /** Replaces the sync API's in-memory copy of `path` with `file`, if it holds one. */
  private async _recache(path: string, inode: Inode, file: File): Promise<void> {
    try {
      this._sync.statSync(path)
    } catch {
      return // Not cached: async reads go to OPFS, and invalidate() handles the rest.
    }
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      try {
        this._sync.unlinkSync(path)
      } catch {
        // Already gone.
      }
      this._sync.createFileSync(path, inode as unknown as CreationOptions)
      this._sync.writeSync(path, data, 0)
      this._sync.touchSync(path, inode)
    } catch (error) {
      logger(`not caching ${path}: ${(error as Error).name}`)
      try {
        this._sync.unlinkSync(path)
      } catch {
        // Nothing was copied.
      }
    }
  }

  /**
   * WebAccessFS.write opens the file with `keepExistingData` and never truncates, so a whole-file
   * overwrite with shorter content (open 'w', then a write at 0) kept the old tail on disk. Here a
   * truncate this mount made since the file was last written (open 'w', ftruncate) is applied in
   * the same writable as the data: the file is cut to that length first (a write past it leaves
   * zeros in the gap, as POSIX does). Without one, the data goes over the file OPFS has, whatever
   * size this mount last saw: appends and writes at an offset never cut off bytes another context
   * wrote.
   */
  async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
    const pending = this._truncates.get(path)
    const inode = this.index.get(path)
    let handle: FileSystemFileHandle | undefined
    if (inode && (inode.mode & constants.S_IFMT) == constants.S_IFREG) {
      try {
        handle = (await this.get('file', path)) as FileSystemFileHandle
      } catch {
        // Not in OPFS yet: WebAccessFS.write creates it, and a new file has no old tail.
      }
    }
    if (!inode || !handle) {
      await super.write(path, buffer, offset)
      this._takeTruncate(path, pending)
      if (inode) this._seen.set(path, { size: inode.size, lastModified: inode.mtimeMs })
      // WebAccessFS.write also creates directories; only files are worth telling other tabs about.
      if (inode && (inode.mode & constants.S_IFMT) == constants.S_IFREG) this._changed(path)
      return
    }

    const data = copyIfShared(buffer)
    const end = offset + data.byteLength
    // Truncated to no more than this write covers: start from an empty file instead of a copy.
    const wholeFile = pending !== undefined && offset == 0 && pending.length <= data.byteLength
    const writable = await handle.createWritable({ keepExistingData: !wholeFile })
    try {
      if (pending && !wholeFile) await writable.truncate(pending.length)
      await writable.write({ type: 'write', position: offset, data })
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => {})
      throw error
    }
    this._takeTruncate(path, pending)

    const file = await handle.getFile()
    const seen = this._seen.get(path)
    inode.update({ size: file.size, mtimeMs: file.lastModified })
    this.index.set(path, inode)
    this._remember(path, file)
    // Larger than this mount's writes explain: another context grew it. The sync API's copy is
    // refreshed by the next stat(), not here, where queued sync writes may not have landed yet.
    const expected = pending ? Math.max(pending.length, end) : Math.max(seen?.size ?? 0, end)
    if (seen && seen.size >= 0 && file.size != expected) this._markChangedElsewhere(path)
    this._changed(path)
  }

  /**
   * ZenFS truncates by setting the inode's size and syncing it with touch() (FileHandle.truncate
   * with no write after it). Make OPFS follow when this mount truncated the file. Any other touch
   * (chmod, utimes, the size after writes) leaves the OPFS file alone: a smaller size there is a
   * stale view, and the index takes the file's real size back.
   */
  async touch(path: string, metadata: InodeLike): Promise<void> {
    const pending = this._truncates.get(path)
    // Skips WebAccessFS.touch, which cuts the OPFS file to any size it's given (a stale one too),
    // for the Async mixin's index and in-memory update that it ends with.
    await asyncTouch.call(this, path, metadata)
    const inode = this.index.get(path)
    if (!inode || (inode.mode & constants.S_IFMT) != constants.S_IFREG) return
    let handle: FileSystemFileHandle
    try {
      handle = (await this.get('file', path)) as FileSystemFileHandle
    } catch {
      return // Not in OPFS (yet): nothing to shrink, and a queued write creates it.
    }

    if (pending) {
      const size = typeof metadata.size == 'number' ? metadata.size : pending.length
      const writable = await handle.createWritable({ keepExistingData: true })
      try {
        await writable.truncate(Math.min(pending.length, size))
        // Truncated, then extended: the new bytes are zeros.
        if (size > pending.length) await writable.truncate(size)
        await writable.close()
      } catch (error) {
        await writable.abort().catch(() => {})
        throw error
      }
      this._takeTruncate(path, pending)
      const file = await handle.getFile()
      inode.update({ size: file.size, mtimeMs: file.lastModified })
      this._remember(path, file)
      this._changed(path)
      return
    }

    const file = await handle.getFile()
    if (inode.size == file.size) return
    const seen = this._seen.get(path)
    inode.update({ size: file.size })
    if (!seen || seen.size != file.size || seen.lastModified != file.lastModified) {
      this._markChangedElsewhere(path)
    }
  }

  async remove(path: string): Promise<void> {
    for (const map of [this._truncates, this._seen]) {
      for (const p of [...map.keys()]) if (p == path || p.startsWith(path + '/')) map.delete(p)
    }
    await super.remove(path)
    this._changed(path)
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
      // Each inode gets its own numbers, as WebAccessFS._loadMetadata gives them.
      const ino = this.index._alloc()
      if (handle.kind == 'directory') {
        this.index.set(path, new Inode({ mode: 0o777 | constants.S_IFDIR, size: 0, ino, data: ino + 1 }))
        continue
      }
      try {
        const { lastModified, size } = await (handle as FileSystemFileHandle).getFile()
        this.index.set(path, new Inode({ mode: 0o644 | constants.S_IFREG, size, mtimeMs: lastModified, ino, data: ino + 1 }))
        this._seen.set(path, { size, lastModified })
      } catch (error) {
        if (!isSkippableOpfsEntryError(error)) throw error
        logger(`skipping file ${path}: ${(error as DOMException).name}`)
        // A removed file's handle would keep resolving to nothing; a locked one is still valid.
        if ((error as DOMException).name == 'NotFoundError') this._handles.delete(path)
      }
    }
  }

  /**
   * The file as OPFS has it, backed by disk: no bytes are read until they're asked for, and none go
   * through the in-memory copy. Waits for queued sync-API writes first, which reach OPFS after the
   * call that made them returned.
   */
  async openFile(path: string): Promise<File> {
    await this.sync()
    return ((await this.get('file', path)) as FileSystemFileHandle).getFile()
  }

  /**
   * Forgets what the mount cached for `path` (size, handle, contents) and reads it again from OPFS.
   * For files written outside this ZenFS instance: by another tab, or by a worker writing to OPFS
   * directly. Only reads OPFS (never writes it, so never calls onOpfsChange).
   *
   * An entry that's gone (removed elsewhere) is forgotten along with anything cached under it, and
   * costs one failed lookup. A file in directories this mount hasn't cached yet (created elsewhere
   * after it mounted) gets them added to the in-memory copy, so the sync API finds it.
   */
  async invalidate(path: string): Promise<void> {
    if (path == '/') return
    this.index.delete(path)
    this._handles.delete(path)
    this._seen.delete(path)
    this._truncates.delete(path)
    let inode: Inode
    try {
      inode = await this.stat(path) // Re-indexes from OPFS (WebAccessFS.stat).
    } catch {
      this._forgetCached(path) // Gone (or unreadable for now: the next stat() looks again).
      return
    }
    try {
      this._sync.unlinkSync(path)
    } catch {
      // Not cached, or a directory: crossCopy refreshes what's under it.
    }
    if ((inode.mode & constants.S_IFMT) == constants.S_IFREG) await this._cacheParents(path)
    await this.crossCopy(path)
  }

  /** Drops `path` and everything under it from the index, handles and in-memory copy. */
  private _forgetCached(path: string): void {
    for (const map of [this._handles, this._seen, this._truncates] as Map<string, unknown>[]) {
      for (const p of [...map.keys()]) if (p == path || p.startsWith(path + '/')) map.delete(p)
    }
    for (const [p] of [...this.index.entries()]) {
      if (p == path || p.startsWith(path + '/')) this.index.delete(p)
    }
    const drop = (p: string): void => {
      let stats: { mode: number }
      try {
        stats = this._sync.statSync(p)
      } catch {
        return // Not cached.
      }
      try {
        if ((stats.mode & constants.S_IFMT) == constants.S_IFDIR) {
          for (const name of this._sync.readdirSync(p)) drop(join(p, name))
          this._sync.rmdirSync(p)
        } else {
          this._sync.unlinkSync(p)
        }
      } catch (error) {
        logger(`could not drop the cached copy of ${p}: ${(error as Error).name}`)
      }
    }
    drop(path)
  }

  /** Adds the directories above `path` that the in-memory copy lacks, so crossCopy can fill it. */
  private async _cacheParents(path: string): Promise<void> {
    const missing: string[] = []
    for (let dir = dirname(path); dir != '/'; dir = dirname(dir)) {
      try {
        this._sync.statSync(dir)
        break
      } catch {
        missing.unshift(dir)
      }
    }
    for (const dir of missing) {
      try {
        const stats = await this.stat(dir)
        // stat() caches a directory it indexes just now.
        if (this._sync.existsSync(dir)) continue
        this._sync.mkdirSync(dir, stats as unknown as CreationOptions)
        this._sync.touchSync(dir, stats)
      } catch (error) {
        logger(`could not cache directory ${dir}: ${(error as Error).name}`)
        return // crossCopy then skips the file (async reads still find it).
      }
    }
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

/** Set by the Async mixin once ready() has copied OPFS into the in-memory cache. */
type AsyncState = { _isInitialized: boolean }

const TRACKED = Symbol.for('seedSdk.tolerantWebAccess.trackTruncates')

/**
 * ZenFS file handles truncate by lowering their inode's size, and only tell the file system the new
 * size later (touch), the same way they report a size that's merely stale. So handles on a
 * TolerantWebAccessFS report each truncate when it's made (open with 'w', ftruncate, truncate).
 * Patches the shared vfs.Handle prototype once; handles on other file systems are unaffected.
 */
function trackTruncates(): void {
  const proto = vfs.Handle.prototype as typeof vfs.Handle.prototype & { [TRACKED]?: true }
  if (proto[TRACKED]) return
  proto[TRACKED] = true
  const fsOf = (handle: vfs.Handle) => (handle.fs instanceof TolerantWebAccessFS ? handle.fs : undefined)

  const truncate = proto.truncate
  proto.truncate = async function (this: vfs.Handle, length: number) {
    const fs = fsOf(this)
    // Noted first: on a sync handle, truncate() syncs (touch) before it returns.
    const undo = fs?._noteTruncate(this.internalPath, length)
    try {
      await truncate.call(this, length)
    } catch (error) {
      undo?.()
      throw error
    }
    fs?._truncateCache(this.internalPath, length)
  }
  const truncateSync = proto.truncateSync
  proto.truncateSync = function (this: vfs.Handle, length: number) {
    const fs = fsOf(this)
    const undo = fs?._noteTruncate(this.internalPath, length)
    try {
      truncateSync.call(this, length)
    } catch (error) {
      undo?.()
      throw error
    }
    fs?._truncateCache(this.internalPath, length)
  }
}
trackTruncates()

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
