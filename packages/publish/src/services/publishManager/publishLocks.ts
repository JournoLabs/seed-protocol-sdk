import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:publishLocks')

/**
 * One tab runs a given seed's publish. Every tab restores `in_progress` publish rows on load, and
 * two tabs resuming the same publish would upload and attest twice. The tab running a publish holds
 * a Web Lock for its seed; the browser releases it when the tab closes or crashes, and the next tab
 * to restore picks the publish up. See docs/MULTI_TAB.md.
 *
 * Where Web Locks are missing (Node, Bun, old browsers) every lock is granted, as before.
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

/**
 * Takes the seed's publish lock if no other tab holds it. Resolves true when this tab holds it
 * (including already), false when another tab is running that publish.
 */
export async function tryHoldPublishLock(seedLocalId: string): Promise<boolean> {
  if (held.has(seedLocalId)) return true
  const locks = getLockManager()
  if (!locks) return true

  return new Promise<boolean>((resolve, reject) => {
    locks
      .request(publishLockName(seedLocalId), { mode: 'exclusive', ifAvailable: true }, (lock) => {
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
          })
          resolve(true)
        })
      })
      .then(
        () => {
          releasing.delete(seedLocalId)
        },
        (error) => {
          releasing.delete(seedLocalId)
          logger(`publish lock request for ${seedLocalId} failed`, error)
          reject(error)
        },
      )
  })
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
 * it. Where Web Locks are missing every tab runs its own publishes, so the answer is `'here'`.
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
