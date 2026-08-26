import { closeFeedStore, encodeKey, openFeedStore } from './store'
import type { SeedFeedOptions } from './types'

export type SeedFeedSession = {
  key: string
  close: () => Promise<void>
}

/**
 * Join the swarm and replicate a feed drive until `close()` (or process exit).
 * Does not generate feed content.
 */
export async function seedFeed(options: SeedFeedOptions): Promise<SeedFeedSession> {
  const handles = await openFeedStore({
    storePath: options.storePath,
    key: options.key,
    announce: true,
  })

  // Prefer longer cores from peers
  try {
    await handles.drive.core.update({ wait: false })
  } catch {
    /* ignore */
  }

  return {
    key: encodeKey(handles.drive.key),
    close: () => closeFeedStore(handles),
  }
}
