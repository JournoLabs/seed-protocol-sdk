import debug from 'debug'
import { eventEmitter } from '@/eventBus'
import { ADDRESSES_PERSISTED_EVENT, LOCAL_COPIES_REMOVED_EVENT } from '@/client/events'
import { EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@/helpers/constants'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { isPostingTabMessages, onTabMessage, postTabMessage } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:helpers:tabEvents')

/**
 * Keeps other tabs current (docs/MULTI_TAB.md). The event bus is per tab, so events that mean "the
 * shared database or OPFS changed" are also posted to the other tabs, which refresh their caches
 * and emit the same event locally. Events are posted only where they originate, so a relayed event
 * is never relayed again.
 */

/** Emitted with the changed paths when files change outside this tab's file-system cache. */
export const FILES_CHANGED_EVENT = 'fs.files.changed' as const

/** Events whose meaning ("the shared data changed") holds in every tab. */
export type CrossTabEventName =
  | typeof EAS_SEED_DATA_SYNCED_TO_DB_EVENT
  | typeof ADDRESSES_PERSISTED_EVENT
  | typeof LOCAL_COPIES_REMOVED_EVENT

/** Emits on this tab's event bus and in every other tab of this database. */
export function emitAcrossTabs(name: CrossTabEventName, payload?: unknown): void {
  if (payload === undefined) {
    eventEmitter.emit(name)
  } else {
    eventEmitter.emit(name, payload)
  }
  postTabMessage({ type: 'event', name, payload })
}

/**
 * A file saved through this tab's file system: emits `file-saved` here. Other tabs hear about it
 * from the file system itself (see queueFilesChangedNotice), once the write has reached OPFS.
 */
export function notifyFileSaved(filePath: string): void {
  eventEmitter.emit('file-saved', filePath)
}

/**
 * Files written straight to OPFS by a worker: refreshes this tab's file-system cache, emits
 * FILES_CHANGED_EVENT, and tells other tabs to do the same.
 */
export async function notifyFilesWrittenOutsideCache(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await BaseFileManager.invalidateCachedPaths(paths)
  eventEmitter.emit(FILES_CHANGED_EVENT, paths)
  queueFilesChangedNotice(paths)
}

/**
 * How long changed paths gather before one `files-changed` message goes out. Counted from the
 * first queued path, so a steady stream of writes still sends once per window, never later.
 */
export const FILES_CHANGED_FLUSH_MS = 25
/** Keeps a message for a huge batch (a bulk download) from being one giant structured clone. */
export const FILES_CHANGED_MAX_PATHS = 500

let pendingChangedPaths = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
let flushOnPageHide = false

/**
 * Tells other tabs that these absolute ZenFS paths changed in OPFS, so they drop and re-read their
 * cached copies (the sync API's in-memory copy in particular). The browser file system calls this
 * for every file it writes, truncates or removes (`TolerantWebAccessFS.onOpfsChange`, wired in
 * `BrowserFileManager.initializeFileSystem`), after the change reached OPFS. Paths are coalesced
 * for FILES_CHANGED_FLUSH_MS, so bulk writes (migrations, schema processing, downloads) send a few
 * messages rather than one per write.
 *
 * Defense in depth only: a tab that misses a message still sees the change on its next async
 * stat() (see TolerantWebAccessFS.stat). A no-op unless this tab coordinates with others.
 */
export function queueFilesChangedNotice(paths: Iterable<string>): void {
  if (!isPostingTabMessages()) return
  for (const path of paths) pendingChangedPaths.add(path)
  if (flushTimer !== undefined || pendingChangedPaths.size === 0) return
  flushTimer = setTimeout(flushFilesChangedNotices, FILES_CHANGED_FLUSH_MS)
  if (!flushOnPageHide && typeof addEventListener === 'function') {
    flushOnPageHide = true
    // A tab closing inside the window still sends what it wrote.
    addEventListener('pagehide', flushFilesChangedNotices)
  }
}

/** Sends the queued paths now (page hide, tests). */
export function flushFilesChangedNotices(): void {
  if (flushTimer !== undefined) clearTimeout(flushTimer)
  flushTimer = undefined
  if (pendingChangedPaths.size === 0) return
  const paths = [...pendingChangedPaths]
  pendingChangedPaths = new Set()
  for (let i = 0; i < paths.length; i += FILES_CHANGED_MAX_PATHS) {
    postTabMessage({ type: 'files-changed', paths: paths.slice(i, i + FILES_CHANGED_MAX_PATHS) })
  }
}

/** Refreshes this tab's in-memory state for an event another tab emitted, before re-emitting it. */
async function catchUpOn(name: string, payload: unknown): Promise<void> {
  if (name === LOCAL_COPIES_REMOVED_EVENT) {
    const { removedSeedLocalIds = [], removedSeedUids = [] } = (payload ?? {}) as {
      removedSeedLocalIds?: string[]
      removedSeedUids?: string[]
    }
    const { Item } = await import('@/Item/Item')
    Item.dropCachedInstancesForSeedIds([...removedSeedLocalIds, ...removedSeedUids])
  }
}

const RELAYED_EVENTS = new Set<string>([
  EAS_SEED_DATA_SYNCED_TO_DB_EVENT,
  ADDRESSES_PERSISTED_EVENT,
  LOCAL_COPIES_REMOVED_EVENT,
])

let listening = false

/** Applies other tabs' events and file changes in this tab. */
export function listenForOtherTabsEvents(): void {
  if (listening) return
  listening = true
  onTabMessage((message) => {
    if (message.type === 'event' && RELAYED_EVENTS.has(message.name)) {
      void catchUpOn(message.name, message.payload)
        .catch((error) => logger(`catching up on ${message.name} failed`, error))
        .then(() => {
          if (message.payload === undefined) {
            eventEmitter.emit(message.name)
          } else {
            eventEmitter.emit(message.name, message.payload)
          }
        })
    } else if (message.type === 'files-changed') {
      // Only refreshes caches: never writes, so never sends files-changed back.
      void BaseFileManager.invalidateCachedPaths(message.paths)
        .catch((error) => logger('refreshing changed files failed', error))
        .then(() => eventEmitter.emit(FILES_CHANGED_EVENT, message.paths))
    }
  })
}
