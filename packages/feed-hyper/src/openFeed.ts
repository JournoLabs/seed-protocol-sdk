import { REGISTRY_PATH } from './paths'
import { closeFeedStore, encodeKey, openFeedStore, type FeedStoreHandles } from './store'
import type { FeedRegistry, OpenFeedOptions } from './types'

export type OpenedFeed = {
  key: string
  version: number
  drive: FeedStoreHandles['drive']
  get: (path: string) => Promise<string | null>
  getRegistry: () => Promise<FeedRegistry | null>
  close: () => Promise<void>
}

/**
 * Open a feed Hyperdrive by public key, join the swarm, and optionally wait for data.
 */
export async function openFeed(options: OpenFeedOptions): Promise<OpenedFeed> {
  const handles = await openFeedStore({
    storePath: options.storePath,
    key: options.key,
    announce: options.announce !== false,
  })

  const syncTimeoutMs = options.syncTimeoutMs ?? 15_000
  if (handles.drive.core.length === 0 && syncTimeoutMs > 0) {
    await Promise.race([
      handles.drive.core.update({ wait: true }),
      new Promise<void>((resolve) => setTimeout(resolve, syncTimeoutMs)),
    ]).catch(() => {
      /* timeout or update failure — caller may still read if peers arrive later */
    })
  }

  const get = async (path: string): Promise<string | null> => {
    const buf = await handles.drive.get(path)
    if (!buf) return null
    return Buffer.from(buf).toString('utf-8')
  }

  const getRegistry = async (): Promise<FeedRegistry | null> => {
    const raw = await get(REGISTRY_PATH)
    if (!raw) return null
    try {
      return JSON.parse(raw) as FeedRegistry
    } catch {
      return null
    }
  }

  return {
    key: encodeKey(handles.drive.key),
    version: handles.drive.version,
    drive: handles.drive,
    get,
    getRegistry,
    close: () => closeFeedStore(handles),
  }
}
