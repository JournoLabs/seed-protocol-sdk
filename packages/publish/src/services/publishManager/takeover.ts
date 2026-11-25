import debug from 'debug'
import { latestPublishRow } from './latestPublishRow'
import {
  emitPublishLockHolderChange,
  isHoldingPublishLock,
  releasePublishLock,
  waitForPublishLock,
} from './publishLocks'
import { readPublishRow, startRestoredRun, type RestoredRun } from './actors/restoreRun'
import { isWaitingForWallet, setWalletRequeue, stopWaitingForWallet, waitForWallet } from './walletWait'

const logger = debug('seedProtocol:PublishManager:takeover')

/**
 * Taking over a publish left running by a closed tab (ADR 0038). For each in-progress publish
 * another tab runs, this tab queues for the seed's publish lock. The browser frees the lock when
 * that tab closes and grants it to the first tab in the queue, which resumes the publish from its
 * saved row, as a reload would. When the publish ended normally instead, each queued tab is granted
 * the lock in turn, finds no in-progress row, and lets the lock go. A tab whose publish wallet doesn't
 * publish as the run's address lets the lock go too, and queues again when its wallet changes
 * (walletWait.ts).
 */

/** What the takeover needs from the manager; set by the manager, which imports this module. */
export type TakeoverTarget = {
  /** Resolves once the manager's own restore has ended. */
  ready: () => Promise<void>
  /** Whether a run of the seed runs or waits in this tab. */
  hasRun: (seedLocalId: string) => boolean
  /** Hands the manager a run this tab took over. */
  takenOver: (seedLocalId: string, run: RestoredRun) => void
  /** Tells other tabs this tab took the seed's lock. */
  announce: (seedLocalId: string) => void
}

let target: TakeoverTarget | undefined
/** seedLocalId → this tab's wait for its lock; `granted` once the lock is this tab's and being decided on. */
const waiting = new Map<string, { abort: AbortController; granted: boolean }>()

export function setTakeoverTarget(next: TakeoverTarget): void {
  target = next
}

/**
 * Queues for the seed's publish lock, and takes the publish over once it is granted. Does nothing
 * while this tab already waits for the seed, holds its lock, or has no manager to hand a run to.
 */
export function watchForTakeover(seedLocalId: string): void {
  // A granted wait that let the lock go (a wallet mismatch) may be queued again before it settles.
  if (!target || waiting.get(seedLocalId)?.granted === false || isHoldingPublishLock(seedLocalId)) return
  const entry = { abort: new AbortController(), granted: false }
  waiting.set(seedLocalId, entry)
  void takeOver(seedLocalId, entry, target)
    .catch((error) => {
      logger(`taking over the publish of ${seedLocalId} failed`, error)
      if (!target?.hasRun(seedLocalId)) releasePublishLock(seedLocalId)
    })
    .finally(() => {
      if (waiting.get(seedLocalId) === entry) waiting.delete(seedLocalId)
    })
}

setWalletRequeue(watchForTakeover)

async function takeOver(
  seedLocalId: string,
  entry: { abort: AbortController; granted: boolean },
  manager: TakeoverTarget,
): Promise<void> {
  await waitForPublishLock(seedLocalId, entry.abort.signal, () => {
    entry.granted = true
    return decide(seedLocalId, entry.abort.signal, manager)
  })
}

/**
 * Runs once this tab is granted the lock, while `createPublish` waits. Each await can end with the
 * lock gone (stopAll) or a run started (a restore that ran late): checked after each one.
 */
async function decide(seedLocalId: string, signal: AbortSignal, manager: TakeoverTarget): Promise<void> {
  /** Lets the lock go unless a run of the seed now uses it; true when the takeover should stop. */
  const stop = () => {
    if (manager.hasRun(seedLocalId)) return true
    if (signal.aborted || !isHoldingPublishLock(seedLocalId)) {
      releasePublishLock(seedLocalId)
      return true
    }
    return false
  }
  await manager.ready()
  if (stop()) return
  const row = await latestPublishRow(seedLocalId)
  if (stop()) return
  const read = row?.status === 'in_progress' ? readPublishRow({ ...row, seedLocalId }) : undefined
  if (!read || read === 'unreadable') {
    // No wallet resumes it: nothing to check again when the wallet changes.
    stopWaitingForWallet(seedLocalId)
    releasePublishLock(seedLocalId)
    return
  }
  // Starts the run with no await before it; one that can't resume, or that this tab's wallet doesn't
  // publish as, is left and its lock let go.
  const run = await startRestoredRun(read, { ...row!, seedLocalId })
  if (!run) return
  logger(`took over the publish of ${seedLocalId} from a closed tab`)
  manager.takenOver(seedLocalId, run)
  emitPublishLockHolderChange(seedLocalId)
  manager.announce(seedLocalId)
}

/**
 * Stops waiting for every lock; a lock granted later resumes nothing. Each of those publishes is
 * checked again when this tab's publish wallet changes, as a host that stops publishes on an account
 * change registers the new account next.
 */
export function stopWatchingForTakeovers(): void {
  for (const [seedLocalId, { abort }] of waiting) {
    abort.abort()
    if (!isWaitingForWallet(seedLocalId)) waitForWallet(seedLocalId)
  }
  waiting.clear()
}
