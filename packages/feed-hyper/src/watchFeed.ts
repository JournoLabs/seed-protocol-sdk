import type Hyperdrive from 'hyperdrive'

export type WatchFeedOptions = {
  /** Called whenever the drive version increases. */
  onUpdate: (version: number) => void | Promise<void>
}

/**
 * Watch a Hyperdrive for new versions (append-only length growth).
 * Returns an unsubscribe function.
 */
export function watchFeed(
  drive: Hyperdrive,
  options: WatchFeedOptions,
): () => void {
  const core = drive.core
  let stopped = false

  const onAppend = () => {
    if (stopped) return
    void Promise.resolve(options.onUpdate(drive.version)).catch((err) => {
      console.error('[feed-hyper] watchFeed onUpdate error:', err)
    })
  }

  core.on('append', onAppend)

  return () => {
    stopped = true
    core.off('append', onAppend)
  }
}
