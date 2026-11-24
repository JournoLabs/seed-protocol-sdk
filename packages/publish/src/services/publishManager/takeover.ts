import debug from 'debug'
import { latestPublishRow } from './latestPublishRow'
import {
  emitPublishLockHolderChange,
  isHoldingPublishLock,
  releasePublishLock,
  waitForPublishLock,
} from './publishLocks'
import { readPublishRow, startRestoredRun, type RestoredRun } from './actors/restoreRun'

const logger = debug('seedProtocol:PublishManager:takeover')

/**
 * Taking over a publish left running by a closed tab (ADR 0038). For each in-progress publish
 * another tab runs, this tab queues for the seed's publish lock. The browser frees the lock when
 * that tab closes and grants it to the first tab in the queue, which resumes the publish from its
 * saved row, as a reload would. When the publish ended normally instead, each queued tab is granted
 * the lock in turn, finds no in-progress row, and lets the lock go.
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
const waiting = new Map<string, AbortController>()

export function setTakeoverTarget(next: TakeoverTarget): void {
  target = next
}

/**
 * Queues for the seed's publish lock, and takes the publish over once it is granted. Does nothing
 * while this tab already waits for the seed, holds its lock, or has no manager to hand a run to.
 */
export function watchForTakeover(seedLocalId: string): void {
  if (!target || waiting.has(seedLocalId) || isHoldingPublishLock(seedLocalId)) return
  const abort = new AbortController()
  waiting.set(seedLocalId, abort)
  void takeOver(seedLocalId, abort.signal, target)
    .catch((error) => {
      logger(`taking over the publish of ${seedLocalId} failed`, error)
      if (!target?.hasRun(seedLocalId)) releasePublishLock(seedLocalId)
    })
    .finally(() => {
      if (waiting.get(seedLocalId) === abort) waiting.delete(seedLocalId)
    })
}

async function takeOver(seedLocalId: string, signal: AbortSignal, manager: TakeoverTarget): Promise<void> {
  await waitForPublishLock(seedLocalId, signal, () => decide(seedLocalId, signal, manager))
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
    releasePublishLock(seedLocalId)
    return
  }
  // Starts the run with no await before it; one that can't resume is marked and its lock let go.
  const run = await startRestoredRun(read, { ...row!, seedLocalId })
  if (!run) return
  logger(`took over the publish of ${seedLocalId} from a closed tab`)
  manager.takenOver(seedLocalId, run)
  emitPublishLockHolderChange(seedLocalId)
  manager.announce(seedLocalId)
}

/** Stops waiting for every lock; a lock granted later resumes nothing. */
export function stopWatchingForTakeovers(): void {
  for (const abort of waiting.values()) abort.abort()
  waiting.clear()
}
