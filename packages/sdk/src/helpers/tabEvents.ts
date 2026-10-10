import debug from 'debug'
import { eventEmitter } from '@/eventBus'
import { ADDRESSES_PERSISTED_EVENT, LOCAL_COPIES_REMOVED_EVENT } from '@/client/events'
import { EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@/helpers/constants'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { onTabMessage, postTabMessage } from '@/helpers/tabCoordinator'

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
 * A file saved through this tab's file system: emits `file-saved` here (as before) and tells other
 * tabs, whose caches don't see it.
 */
export function notifyFileSaved(filePath: string): void {
  eventEmitter.emit('file-saved', filePath)
  postTabMessage({ type: 'files-changed', paths: [filePath] })
}

/**
 * Files written straight to OPFS by a worker: refreshes this tab's file-system cache, emits
 * FILES_CHANGED_EVENT, and tells other tabs to do the same.
 */
export async function notifyFilesWrittenOutsideCache(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await BaseFileManager.invalidateCachedPaths(paths)
  eventEmitter.emit(FILES_CHANGED_EVENT, paths)
  postTabMessage({ type: 'files-changed', paths })
}

/** Refreshes this tab's in-memory state for an event another tab emitted, before re-emitting it. */
async function catchUpOn(name: string, payload: unknown): Promise<void> {
  if (name === EAS_SEED_DATA_SYNCED_TO_DB_EVENT) {
    const { Item } = await import('@/Item/Item')
    await Item.rehydrateCachedItemsFromDbAfterEasSync()
  } else if (name === LOCAL_COPIES_REMOVED_EVENT) {
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
      void BaseFileManager.invalidateCachedPaths(message.paths)
        .catch((error) => logger('refreshing changed files failed', error))
        .then(() => eventEmitter.emit(FILES_CHANGED_EVENT, message.paths))
    }
  })
}
