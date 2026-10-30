import debug from 'debug'
import { isBrowser } from '@/helpers/environment'
import { withTabLock, type TabLockOptions } from '@/helpers/tabLocks'

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
export type TabMessage =
  | { type: 'eas-sync-address-change'; addresses: string[] }
  /** An event-bus event emitted in another tab (see helpers/tabEvents.ts). */
  | { type: 'event'; name: string; payload?: unknown }
  /** OPFS paths another tab (or its workers) wrote or removed, coalesced (helpers/tabEvents.ts). */
  | { type: 'files-changed'; paths: string[] }
  /** Outbox ops were appended: the leader drains them (ADR 0019, outbox/outbox.ts). */
  | { type: 'outbox-nudge' }
  /** Outbox ops were applied, superseded or failed: tabs waiting on them re-read their status. */
  | { type: 'outbox-settled'; opIds: string[] }
  /** `client.resetLocalData()` in another tab: stop the client so the database can be deleted. */
  | { type: 'close-db' }

/** A message as sent: `from` is the sending tab's TAB_ID, so a tab can drop its own messages. */
type SentTabMessage = TabMessage & { from?: string }

/** Identifies this tab (this page's SDK instance) in the messages it sends. */
export const TAB_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

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

/** Starts once per page until stopTabCoordination; later calls (re-init) keep the first database. */
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
  channel.onmessage = (event: MessageEvent<SentTabMessage>) => {
    // A BroadcastChannel never hears itself, but another channel object in this page would (a
    // second channel opened by a test, or the same module loaded twice): skip our own messages.
    if (event.data?.from === TAB_ID) return
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
  state?.channel?.postMessage({ ...message, from: TAB_ID } satisfies SentTabMessage)
}

/** Whether postTabMessage reaches other tabs (a browser tab coordinating with Web Locks). */
export function isPostingTabMessages(): boolean {
  return !!state?.channel
}

export function onTabMessage(handler: (message: TabMessage) => void): () => void {
  messageHandlers.add(handler)
  return () => messageHandlers.delete(handler)
}

/** `withTabLock` named for this database (`seed:<scope>:<db>`); runs `fn` directly before init. */
export function withDbTabLock<T>(scope: string, fn: () => Promise<T>, options?: TabLockOptions): Promise<T> {
  return state ? withTabLock(`seed:${scope}:${state.dbKey}`, fn, options) : fn()
}

/**
 * Ends this tab's coordination (client.stop): hands leadership to another tab and closes the
 * channel. The next startTabCoordination starts over, for whatever database init then opens.
 * Keeps message handlers (modules register theirs once per page) and whenLeaderTab waiters, which
 * resolve once this tab leads again.
 */
export function stopTabCoordination(): void {
  state?.releaseLeadership?.()
  state?.channel?.close()
  state = undefined
  leader = false
}

/**
 * Each coordinating tab holds the Web Lock `seed:open:<db>` in shared mode from init until its
 * database has closed. `client.resetLocalData()` takes it exclusively, so it deletes once every
 * such tab has let go, and an init in any tab waits until the delete is done.
 */
export function dbOpenLockName(filesDir: string): string {
  return `seed:open:${filesDir}/db/seed.db`
}

type OpenLockHold = { dbKey: string; cancelled: boolean; release?: () => void }
let openLockHold: OpenLockHold | undefined

/**
 * Takes this tab's shared hold on `seed:open:<db>` (see dbOpenLockName) and resolves once it is
 * granted, which waits out a reset in progress. Does nothing when this tab isn't coordinating or
 * already holds it.
 */
export function holdDbOpenLock(): Promise<void> {
  if (!state?.coordinating) return Promise.resolve()
  if (openLockHold?.dbKey === state.dbKey) return Promise.resolve()
  releaseDbOpenLock()
  const hold: OpenLockHold = { dbKey: state.dbKey, cancelled: false }
  openLockHold = hold
  return new Promise<void>((resolve) => {
    navigator.locks
      .request(`seed:open:${hold.dbKey}`, { mode: 'shared' }, () => {
        resolve()
        // Released before the grant (the client stopped while waiting): hand it straight back.
        if (hold.cancelled) return undefined
        return new Promise<void>((release) => {
          hold.release = release
        })
      })
      .catch((error) => {
        logger('open lock request failed', error)
        resolve()
      })
  })
}

/** Lets go of this tab's hold on `seed:open:<db>`, once its database has closed. */
export function releaseDbOpenLock(): void {
  if (!openLockHold) return
  openLockHold.cancelled = true
  openLockHold.release?.()
  openLockHold = undefined
}

/** Tests only. */
export function resetTabCoordinationForTests(): void {
  stopTabCoordination()
  releaseDbOpenLock()
  leaderWaiters = []
}
