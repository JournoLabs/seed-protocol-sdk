import debug from 'debug'
import { isBrowser } from '@/helpers/environment'
import { withTabLock } from '@/helpers/tabLocks'

const logger = debug('seedSdk:helpers:tabCoordinator')

/**
 * One leader tab per database runs background work (EAS sync, bulk downloads, the Arweave L1
 * finalize worker); other tabs skip it. Leadership is a Web Lock held for the tab's lifetime, so
 * when the leader closes or crashes the next waiting tab takes over. See docs/MULTI_TAB.md.
 *
 * - `'coordinate'` (default): elect a leader in browsers with Web Locks.
 * - `'off'`: every tab acts as leader (behavior before multi-tab support).
 *
 * Node, browsers without Web Locks, and code running before client init always act as leader.
 */
export type MultiTabMode = 'coordinate' | 'off'

/** Messages between tabs of the same database. */
export type TabMessage = { type: 'eas-sync-address-change'; addresses: string[] }

type CoordinationState = {
  dbKey: string
  coordinating: boolean
  channel?: BroadcastChannel
  releaseLeadership?: () => void
}

let state: CoordinationState | undefined
let leader = false
let leaderWaiters: Array<() => void> = []
const messageHandlers = new Set<(message: TabMessage) => void>()

/** Starts once per page; later calls (re-init) keep the first database. */
export function startTabCoordination({ filesDir, mode = 'coordinate' }: { filesDir: string; mode?: MultiTabMode }): void {
  if (state) return
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const dbKey = `${filesDir}/db/seed.db`
  const coordinating = mode === 'coordinate' && isBrowser() && !!locks && typeof BroadcastChannel !== 'undefined'
  state = { dbKey, coordinating }

  if (!coordinating) {
    becomeLeader()
    return
  }

  const channel = new BroadcastChannel(`seed:tabs:${dbKey}`)
  channel.onmessage = (event: MessageEvent<TabMessage>) => {
    for (const handler of messageHandlers) handler(event.data)
  }
  state.channel = channel

  const current = state
  void locks!.request(`seed:leader:${dbKey}`, () => {
    // Reset (tests) before the grant: hand the lock straight back.
    if (state !== current) return undefined
    becomeLeader()
    // Held until the tab closes (or a test resets coordination).
    return new Promise<void>((release) => {
      current.releaseLeadership = release
    })
  })
}

function becomeLeader(): void {
  if (leader) return
  leader = true
  logger(`this tab leads ${state?.dbKey}`)
  const waiters = leaderWaiters
  leaderWaiters = []
  for (const resolve of waiters) resolve()
}

export function isLeaderTab(): boolean {
  return !state || leader
}

/** Resolves when this tab leads (at once if it already does). */
export function whenLeaderTab(): Promise<void> {
  if (isLeaderTab()) return Promise.resolve()
  return new Promise((resolve) => leaderWaiters.push(resolve))
}

/** Sends to the other tabs of this database; a no-op when not coordinating. */
export function postTabMessage(message: TabMessage): void {
  state?.channel?.postMessage(message)
}

export function onTabMessage(handler: (message: TabMessage) => void): () => void {
  messageHandlers.add(handler)
  return () => messageHandlers.delete(handler)
}

/** `withTabLock` named for this database (`seed:<scope>:<db>`); runs `fn` directly before init. */
export function withDbTabLock<T>(scope: string, fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
  return state ? withTabLock(`seed:${scope}:${state.dbKey}`, fn, options) : fn()
}

/** Tests only. */
export function resetTabCoordinationForTests(): void {
  state?.releaseLeadership?.()
  state?.channel?.close()
  state = undefined
  leader = false
  leaderWaiters = []
  messageHandlers.clear()
}
