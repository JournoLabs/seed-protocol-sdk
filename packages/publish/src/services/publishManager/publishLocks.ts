import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:publishLocks')

/**
 * One tab runs a given seed's publish. Every tab restores `in_progress` publish rows on load, and
 * two tabs resuming the same publish would upload and attest twice. The tab running a publish holds
 * a Web Lock for its seed; the browser releases it when the tab closes or crashes, and the next tab
 * to restore picks the publish up. See docs/MULTI_TAB.md.
 *
 * Where Web Locks are missing (Bun, old browsers) every lock is granted, as before. Node has
 * `navigator.locks`, which covers one process, so there a seed's publish runs once per process.
 */

type LockManagerLike = Pick<LockManager, 'request' | 'query'>

let getLockManager = (): LockManagerLike | undefined =>
  typeof navigator !== 'undefined' ? navigator.locks : undefined

/** seedLocalId → releases this tab's lock */
const held = new Map<string, () => void>()
/**
 * Locks this tab has let go of that the lock manager still lists: it frees the name only once the
 * request settles. Without this, `publishLockHolder` would call this tab's own lock another tab's.
 */
const releasing = new Set<string>()

export function publishLockName(seedLocalId: string): string {
  return `seed:publish:${seedLocalId}`
}

/** Called with a seed whose lock this tab took, was granted or let go of. */
type HolderChangeListener = (seedLocalId: string) => void
const holderChangeListeners = new Set<HolderChangeListener>()

/**
 * Calls `listener` with a seed whose publish lock holder may have changed, so it can read
 * `publishLockHolder` again. A tab can't watch other tabs' locks, so this fires when this tab takes
 * or lets go of a lock, when a lock it was waiting for is granted (the tab holding it let go), and
 * when another tab says it took one (`emitPublishLockHolderChange`). Returns the unsubscribe
 * function.
 */
export function onPublishLockHolderChange(listener: HolderChangeListener): () => void {
  holderChangeListeners.add(listener)
  return () => {
    holderChangeListeners.delete(listener)
  }
}

export function emitPublishLockHolderChange(seedLocalId: string): void {
  for (const listener of [...holderChangeListeners]) {
    try {
      listener(seedLocalId)
    } catch (error) {
      logger('publish lock holder listener threw', error)
    }
  }
}

/**
 * Requests the seed's lock and, once granted, holds it until `releasePublishLock`. Resolves true
 * when held, false when `ifAvailable` found it held elsewhere or `signal` aborted the wait.
 */
function holdPublishLock(
  seedLocalId: string,
  options: { ifAvailable: true } | { signal: AbortSignal },
): Promise<boolean> {
  const locks = getLockManager()
  if (!locks) return Promise.resolve(true)

  return new Promise<boolean>((resolve, reject) => {
    locks
      .request(publishLockName(seedLocalId), { mode: 'exclusive', ...options }, (lock) => {
        if (!lock) {
          resolve(false)
          return undefined
        }
        // Hold until released; the callback's promise is the lock's lifetime.
        return new Promise<void>((release) => {
          held.set(seedLocalId, () => {
            held.delete(seedLocalId)
            releasing.add(seedLocalId)
            release()
            emitPublishLockHolderChange(seedLocalId)
          })
          resolve(true)
          emitPublishLockHolderChange(seedLocalId)
        })
      })
      .then(
        () => {
          releasing.delete(seedLocalId)
        },
        (error) => {
          releasing.delete(seedLocalId)
          if ('signal' in options && options.signal.aborted) {
            resolve(false)
            return
          }
          logger(`publish lock request for ${seedLocalId} failed`, error)
          reject(error)
        },
      )
  })
}

/**
 * Takes the seed's publish lock if no other tab holds it. Resolves true when this tab holds it
 * (including already), false when another tab is running that publish.
 */
export async function tryHoldPublishLock(seedLocalId: string): Promise<boolean> {
  if (held.has(seedLocalId)) return true
  return holdPublishLock(seedLocalId, { ifAvailable: true })
}

/**
 * Waits for the seed's publish lock, queued behind the tab holding it, and holds it once that tab
 * lets go (when it closes, or its publish ends). Resolves false if `signal` aborts first.
 */
export async function waitForPublishLock(seedLocalId: string, signal: AbortSignal): Promise<boolean> {
  if (held.has(seedLocalId)) return true
  if (signal.aborted) return false
  return holdPublishLock(seedLocalId, { signal })
}

export function releasePublishLock(seedLocalId: string): void {
  held.get(seedLocalId)?.()
}

export function releaseAllPublishLocks(): void {
  for (const release of [...held.values()]) release()
}

export function isHoldingPublishLock(seedLocalId: string): boolean {
  return held.has(seedLocalId)
}

/** Who runs a seed's publish: this tab, another tab of the origin, or no tab. */
export type PublishLockHolder = 'here' | 'other-tab' | 'none'

/**
 * Whether this tab runs the seed's publish, another tab does, or no tab holds its lock. Every tab
 * sees the same `in_progress` rows in `publish_processes`; this tells them apart. `'none'` for an
 * `in_progress` row means the tab that ran it closed: it stays unrun until a tab loads and restores
 * it. Where Web Locks are missing (Bun, old browsers) every tab runs its own publishes, so the answer is
 * `'here'`. Node has them for its process: there the answer is `'none'` for a seed no publish holds.
 */
export async function publishLockHolder(seedLocalId: string): Promise<PublishLockHolder> {
  if (held.has(seedLocalId)) return 'here'
  const locks = getLockManager()
  if (!locks) return 'here'
  if (releasing.has(seedLocalId)) return 'none'
  const name = publishLockName(seedLocalId)
  const { held: heldLocks = [] } = await locks.query()
  return heldLocks.some((lock) => lock.name === name) ? 'other-tab' : 'none'
}

/** Tests only: swap the lock manager (Bun has no navigator.locks). */
export function setPublishLockManagerForTests(locks: LockManagerLike | undefined): void {
  releaseAllPublishLocks()
  getLockManager = () => locks
}
