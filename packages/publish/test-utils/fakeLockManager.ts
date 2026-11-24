/**
 * Stand-in for the origin-wide Web Locks manager (Bun has none), for `setPublishLockManagerForTests`.
 * `otherTab` holds names the way another open tab of the app would. A request that doesn't pass
 * `ifAvailable` waits in a first-in, first-out queue for its name, as in a browser, and `signal`
 * takes it out of the queue.
 */
export function fakeLockManager() {
  const heldNames = new Set<string>()
  /** name → grants of the requests waiting for it, oldest first */
  const queues = new Map<string, Array<{ grant: () => void }>>()

  /** Frees `name`, handing it to the oldest waiting request, which holds it from that moment. */
  const free = (name: string) => {
    heldNames.delete(name)
    const next = queues.get(name)?.shift()
    if (queues.get(name)?.length === 0) queues.delete(name)
    if (next) {
      heldNames.add(name)
      next.grant()
    }
  }

  const otherTab = {
    hold: (name: string) => heldNames.add(name),
    release: (name: string) => free(name),
  }

  const wait = (name: string, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        return
      }
      const entry = {
        grant: () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        },
      }
      const onAbort = () => {
        const queue = queues.get(name)
        const i = queue?.indexOf(entry) ?? -1
        if (i < 0) return
        queue!.splice(i, 1)
        if (queue!.length === 0) queues.delete(name)
        reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      queues.set(name, [...(queues.get(name) ?? []), entry])
    })

  const locks = {
    async request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
      if (heldNames.has(name)) {
        if (options.ifAvailable) return callback(null)
        await wait(name, options.signal)
      } else {
        heldNames.add(name)
      }
      try {
        return await callback({ name, mode: 'exclusive' } as Lock)
      } finally {
        free(name)
      }
    },
    async query(): Promise<LockManagerSnapshot> {
      return {
        held: [...heldNames].map((name) => ({ name, mode: 'exclusive' })),
        pending: [...queues].flatMap(([name, queue]) => queue.map(() => ({ name, mode: 'exclusive' as const }))),
      }
    },
  } as unknown as Pick<LockManager, 'request' | 'query'>
  return { locks, otherTab, heldNames }
}
