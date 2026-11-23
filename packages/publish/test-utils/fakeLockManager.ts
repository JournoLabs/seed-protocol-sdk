/**
 * Stand-in for the origin-wide Web Locks manager (Bun has none), for `setPublishLockManagerForTests`.
 * `otherTab` holds names the way another open tab of the app would.
 */
export function fakeLockManager() {
  const heldNames = new Set<string>()
  const otherTab = {
    hold: (name: string) => heldNames.add(name),
    release: (name: string) => heldNames.delete(name),
  }
  const locks = {
    async request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
      if (heldNames.has(name)) {
        if (options.ifAvailable) return callback(null)
        throw new Error('fake lock manager only supports ifAvailable for held names')
      }
      heldNames.add(name)
      try {
        return await callback({ name, mode: 'exclusive' } as Lock)
      } finally {
        heldNames.delete(name)
      }
    },
    async query(): Promise<LockManagerSnapshot> {
      return { held: [...heldNames].map((name) => ({ name, mode: 'exclusive' })), pending: [] }
    },
  } as unknown as Pick<LockManager, 'request' | 'query'>
  return { locks, otherTab, heldNames }
}
