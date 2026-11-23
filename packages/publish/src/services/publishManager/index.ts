import { ActorRefFrom, assign, createActor, setup } from 'xstate'
import {
  announcePublishLockTaken,
  BaseDb,
  findOpenPublishAttempts,
  Item,
  onPublishLockTaken,
  updatePublishAttempt,
} from '@seedprotocol/sdk'
import { publishMachine } from '../publish'
import { assignRestoreFromDb } from './actions/assignRestoreFromDb'
import { createPublish } from './actions/createPublish'
import { isParkedRun, isParkedValue } from './parkedRun'
import { latestPublishRow } from './latestPublishRow'
import { getPublishMachineValueForUi } from '~/helpers/publishDisplayHelpers'
import { partsSentUnderNonceKey } from '~/helpers/nonceKeyParts'
import { retryAttestations } from './actions/retryAttestations'
import { stopPublish } from './actions/stopPublish'
import { giveUpPublish } from './actions/giveUpPublish'
import { stopAll } from './actions/stopAll'
import { addSubscription } from './actions/addSubscription'
import { requestSavePublish } from './actions/requestSavePublish'
import { publishDone } from './actions/publishDone'
import { removeSubscription } from './actions/removeSubscription'
import { restoreFromDb, restoreWhenDbReady, type PublishRestoreStatus } from './actors/restoreFromDb'
import { queueCreatePublish } from './actions/queueCreatePublish'
import { drainPendingCreates } from './actions/drainPendingCreates'
import { registerCreatePublishResolver } from './createPublishResult'
import { setPublishManagerRef } from './publishManagerRef'
import {
  emitPublishLockHolderChange,
  isHoldingPublishLock,
  publishLockHolder,
  releasePublishLock,
  tryHoldPublishLock,
} from './publishLocks'
import { setTakeoverTarget, stopWatchingForTakeovers, watchForTakeover } from './takeover'
import type { RestoredRun } from './actors/restoreRun'
import { settleAttestationAttempt, type AttestationSettleResult } from './settleAttestationAttempt'
import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:index')

/**
 * What a run replacing a parked one takes from it (ADR 0036): its uploads, its host `nonceKey`, and
 * how many parts went out under that key. The count goes with the key only.
 */
export type ReplaceParked = {
  reuseUploads: Array<import('../../types').PublishUpload & { txId: string }>
  nonceKey?: string
  nonceKeyParts: number
}

/**
 * What stands in the way of a new publish of a seed. `attempt_open`: an attestation attempt for it
 * is open, whatever the run's state. `parked`: this tab's run waits after a failed attestation and
 * a new publish replaces it. `running`: this tab's run is in any other state.
 * `parked_in_other_tab`: another tab of the origin holds the seed's publish and its saved state is
 * one of those waiting states; it is retried in that tab. `running_in_other_tab`: another tab holds
 * it in any other state, or before its first save.
 */
export type PublishBlocker =
  | 'none'
  | 'running'
  | 'parked'
  | 'attempt_open'
  | 'parked_in_other_tab'
  | 'running_in_other_tab'

export interface PublishManagerMachineContext {
  publishProcesses: Map<string, import('xstate').ActorRef<any, any>>
  subscriptions: Map<string, import('xstate').ActorRef<any, import('xstate').EventObject>>
  /** CREATE_PUBLISH events received before restore finishes. */
  pendingCreates: PublishManagerEvent[]
  /** Last finished actor per seed. Not used by the in-flight duplicate guard. */
  settledPublishes: Map<string, import('xstate').ActorRef<any, any>>
  restoreStatus: PublishRestoreStatus
}

type PublishManagerEvent =
  | { type: 'RESTORE_FROM_DB_DONE'; publishProcesses: PublishManagerMachineContext['publishProcesses']; subscriptions: PublishManagerMachineContext['subscriptions']; status: PublishRestoreStatus; heldElsewhere?: string[] }
  | ({ type: 'PUBLISH_TAKEN_OVER'; seedLocalId: string } & RestoredRun)
  | { type: 'CREATE_PUBLISH'; item: import('@seedprotocol/sdk').Item<any>; address: string; account?: unknown; options?: import('../../config').CreatePublishOptions; createToken?: number; replaceParked?: ReplaceParked }
  | { type: 'ADD_SUBSCRIPTION'; seedLocalId: string; newSubscription?: import('xstate').ActorRef<any, any> }
  | { type: 'REQUEST_SAVE_PUBLISH'; seedLocalId: string; publishProcess?: unknown; triggerPublishDone?: boolean }
  | { type: 'SAVE_PUBLISH_DONE'; seedLocalId: string; triggerPublishDone?: boolean }
  | { type: 'PUBLISH_DONE'; seedLocalId: string }
  | { type: 'REMOVE_SUBSCRIPTION'; seedLocalId: string }
  | { type: 'RETRY_ATTESTATIONS'; seedLocalId: string; account?: unknown }
  | { type: 'STOP_PUBLISH'; seedLocalId: string }
  | { type: 'GIVE_UP'; seedLocalId: string }
  | { type: 'STOP_ALL' }

export const publishManagerMachine = setup({
  types: {
    context: {} as PublishManagerMachineContext,
    input: {} as PublishManagerMachineContext,
    events: {} as PublishManagerEvent,
  },
  actors: {
    restoreFromDb,
    restoreWhenDbReady,
  },
  actions: {
    assignRestoreFromDb,
    watchHeldElsewhere: ({ event }: { event: PublishManagerEvent }) => {
      if (event.type !== 'RESTORE_FROM_DB_DONE') return
      for (const seedLocalId of event.heldElsewhere ?? []) watchForTakeover(seedLocalId)
    },
    assignTakenOver: assign(({ context, event }: { context: PublishManagerMachineContext; event: PublishManagerEvent }) => {
      if (event.type !== 'PUBLISH_TAKEN_OVER') return {}
      return {
        publishProcesses: new Map(context.publishProcesses).set(event.seedLocalId, event.publishProcess),
        subscriptions: new Map(context.subscriptions).set(event.seedLocalId, event.subscription),
      }
    }),
    createPublish,
    queueCreatePublish,
    drainPendingCreates,
    addSubscription,
    requestSavePublish,
    publishDone,
    removeSubscription,
    retryAttestations,
    stopPublish,
    giveUpPublish,
    stopAll,
  } as unknown as Record<string, (args: unknown) => void>,
}).createMachine({
  id: 'publishManager',
  initial: 'restoreFromDb',
  context: {
    publishProcesses: new Map(),
    subscriptions: new Map(),
    pendingCreates: [],
    settledPublishes: new Map(),
    restoreStatus: { outcome: 'pending' },
  },
  states: {
    restoreFromDb: {
      on: {
        RESTORE_FROM_DB_DONE: {
          target: 'active',
          actions: ['assignRestoreFromDb', 'watchHeldElsewhere'],
        },
        CREATE_PUBLISH: {
          actions: ['queueCreatePublish'],
        },
      },
      invoke: {
        src: 'restoreFromDb',
        input: ({ context }) => ({ context }),
      },
    },
    active: {
      entry: 'drainPendingCreates',
      invoke: {
        src: 'restoreWhenDbReady',
        input: ({ context }) => ({ context, status: context.restoreStatus }),
      },
      on: {
        RESTORE_FROM_DB_DONE: {
          actions: ['assignRestoreFromDb', 'watchHeldElsewhere'],
        },
        PUBLISH_TAKEN_OVER: {
          actions: ['assignTakenOver'],
        },
        CREATE_PUBLISH: {
          actions: ['createPublish'],
        },
        ADD_SUBSCRIPTION: {
          actions: ['addSubscription'],
        },
        REQUEST_SAVE_PUBLISH: {
          actions: ['requestSavePublish'],
        },
        SAVE_PUBLISH_DONE: [
          {
            guard: ({ event }) => (event as { triggerPublishDone?: boolean }).triggerPublishDone === true,
            actions: ['publishDone'],
          },
        ],
        PUBLISH_DONE: {
          actions: ['publishDone'],
        },
        REMOVE_SUBSCRIPTION: {
          actions: ['removeSubscription'],
        },
        RETRY_ATTESTATIONS: {
          actions: ['retryAttestations'],
        },
        STOP_PUBLISH: {
          actions: ['stopPublish'],
        },
        GIVE_UP: {
          actions: ['giveUpPublish'],
        },
        STOP_ALL: {
          actions: ['stopAll'],
        },
      },
    },
  },
})

const initialManagerContext = {
  publishProcesses: new Map(),
  subscriptions: new Map(),
  pendingCreates: [] as PublishManagerEvent[],
  settledPublishes: new Map(),
  restoreStatus: { outcome: 'pending' } as PublishRestoreStatus,
}

const publishManager = createActor(publishManagerMachine, {
  input: initialManagerContext,
})

/** Whether a publish of the seed runs or waits in this tab. A finished one doesn't count. */
const hasRun = (seedLocalId: string) => publishManager.getSnapshot().context.publishProcesses.has(seedLocalId)

/** What a run replacing the parked run of the seed takes from it, from that run's snapshot and attempts. */
async function replaceParkedFrom(seedLocalId: string): Promise<ReplaceParked | undefined> {
  const run = publishManager.getSnapshot().context.publishProcesses.get(seedLocalId)
  if (!run) return undefined
  const context = (run.getSnapshot() as { context?: import('../../types').PublishMachineContext }).context
  const transactions = context?.arweaveTransactions ?? []
  const uploads = (context?.publishUploads ?? []) as import('../../types').PublishUpload[]
  const reuseUploads = uploads.flatMap((upload, i) => {
    const txId = transactions[i]?.transaction?.id
    return upload && typeof txId === 'string' ? [{ ...upload, txId }] : []
  })
  return {
    reuseUploads,
    ...(context?.nonceKey !== undefined && { nonceKey: context.nonceKey }),
    nonceKeyParts: context ? await partsSentUnderNonceKey(context) : 0,
  }
}

/**
 * `snapshot.status === 'active'` is true before `start()` and while restore is running.
 * This flag is the only signal that `start()` has been called. Calling it twice throws.
 */
let publishManagerStarted = false

function ensurePublishManagerStarted() {
  if (publishManagerStarted) return
  try {
    publishManager.start()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/already started/i.test(message)) throw err
  }
  publishManagerStarted = true
}

// Set ref for subscribe actor to call savePublish, onPublishDone, removeSubscription
setPublishManagerRef({
  savePublish: (seedLocalId, publishProcess, options) => {
    publishManager.send({
      type: 'REQUEST_SAVE_PUBLISH',
      seedLocalId,
      publishProcess,
      triggerPublishDone: options?.triggerPublishDone,
    })
  },
  onPublishDone: (seedLocalId) => {
    publishManager.send({ type: 'PUBLISH_DONE', seedLocalId })
  },
  removeSubscription: (seedLocalId) => {
    publishManager.send({ type: 'REMOVE_SUBSCRIPTION', seedLocalId })
  },
})

setTakeoverTarget({
  ready: () => PublishManager.ready(),
  hasRun,
  takenOver: (seedLocalId, run) => publishManager.send({ type: 'PUBLISH_TAKEN_OVER', seedLocalId, ...run }),
  announce: announcePublishLockTaken,
})

// Another tab took a seed's publish lock: its holder changed, and this tab queues to take the
// publish over should that tab close.
onPublishLockTaken((seedLocalId) => {
  emitPublishLockHolderChange(seedLocalId)
  watchForTakeover(seedLocalId)
})

const subscription = publishManager.subscribe((snapshot) => {
  logger('PublishManager snapshot:', snapshot)
})

if (typeof document !== 'undefined') {
  ensurePublishManagerStarted()

  window.addEventListener('load', () => {
    logger('PublishManager started')
  })

  window.addEventListener('beforeunload', () => {
    subscription.unsubscribe()
    stopWatchingForTakeovers()
    publishManager.stop()
  })
}

export const PublishManager = {
  getService: () => publishManager,
  /**
   * Start the manager if this process has not, then resolve when the machine value is `active`.
   * Node does not auto-start. `getSnapshot().status` is not readiness.
   */
  ready: (): Promise<void> => {
    ensurePublishManagerStarted()
    if (publishManager.getSnapshot().value === 'active') return Promise.resolve()
    return new Promise((resolve) => {
      const sub = publishManager.subscribe((snapshot) => {
        if (snapshot.value === 'active') {
          sub.unsubscribe()
          resolve()
        }
      })
      if (publishManager.getSnapshot().value === 'active') {
        sub.unsubscribe()
        resolve()
      }
    })
  },
  /**
   * Whether this tab's in-progress publishes were restored. `dbNotReady` moves on by itself once
   * the database is ready; `failed` holds the error, and those publishes aren't running here.
   */
  getRestoreStatus: (): PublishRestoreStatus => publishManager.getSnapshot().context.restoreStatus,
  /** Calls `listener` when the restore status changes. Returns the unsubscribe function. */
  onRestoreStatus: (listener: (status: PublishRestoreStatus) => void): (() => void) => {
    let last = publishManager.getSnapshot().context.restoreStatus
    const sub = publishManager.subscribe((snapshot) => {
      if (snapshot.context.restoreStatus === last) return
      last = snapshot.context.restoreStatus
      listener(last)
    })
    return () => sub.unsubscribe()
  },
  /**
   * What stands in the way of publishing the seed now ({@link PublishBlocker}). A publish in
   * another tab is found by its lock, and told parked or running by the state its tab last saved.
   */
  publishBlocker: async (seedLocalId: string): Promise<PublishBlocker> => {
    // With no database yet there are no attempts to read; the send's claim checks again.
    if (BaseDb.isAppDbReady() && (await findOpenPublishAttempts([seedLocalId])).length > 0) return 'attempt_open'
    const run = publishManager.getSnapshot().context.publishProcesses.get(seedLocalId)
    if (run) return isParkedRun(run) ? 'parked' : 'running'
    if ((await publishLockHolder(seedLocalId)) !== 'other-tab') return 'none'
    const row = await latestPublishRow(seedLocalId)
    return row?.status === 'in_progress' && isParkedValue(getPublishMachineValueForUi(row))
      ? 'parked_in_other_tab'
      : 'running_in_other_tab'
  },
  /**
   * Spawn a publish. Resolves with the child actor once it exists.
   * Resolves `undefined` when the address is missing, when an attestation attempt for the seed is
   * open, or when that seed is already in flight, in this tab or another one. A run of the seed in
   * this tab parked after a failed attestation is stopped, its row marked `interrupted`, and
   * replaced: the new run reuses its stored uploads and goes on from its recorded parts (ADR 0036).
   * This promise means the process started, not that the chain publish finished.
   */
  createPublish: async (
    item: InstanceType<typeof Item>,
    address: string,
    account?: import('../../helpers/seedSigner').PublishWallet,
    options?: import('../../config').CreatePublishOptions
  ): Promise<import('xstate').ActorRef<any, any> | undefined> => {
    const { seedLocalId } = item
    const heldBefore = isHoldingPublishLock(seedLocalId)
    if (!(await tryHoldPublishLock(seedLocalId))) {
      console.warn(`[createPublish] "${seedLocalId}" is already publishing in another tab; skipping.`)
      return undefined
    }
    // A run restore brings back isn't in the map until restore ends; a parked one is replaced.
    if (publishManagerStarted && publishManager.getSnapshot().value !== 'active') await PublishManager.ready()
    const blocker = await PublishManager.publishBlocker(seedLocalId)
    const replaceParked = blocker === 'parked' ? await replaceParkedFrom(seedLocalId) : undefined
    const publishProcess =
      blocker === 'running' || blocker === 'attempt_open'
        ? undefined
        : await new Promise<import('xstate').ActorRef<any, any> | undefined>((resolve) => {
            const createToken = registerCreatePublishResolver(resolve)
            publishManager.send({ type: 'CREATE_PUBLISH', item, address, account, options, createToken, replaceParked })
          })
    // Nothing spawned (e.g. no address): don't keep a lock this call took.
    if (!publishProcess && !heldBefore) releasePublishLock(seedLocalId)
    // Other tabs queue to take it over should this tab close.
    if (publishProcess && !heldBefore) announcePublishLockTaken(seedLocalId)
    return publishProcess
  },
  retryAttestations: (seedLocalId: string, account?: import('../../helpers/seedSigner').PublishWallet) =>
    publishManager.send({ type: 'RETRY_ATTESTATIONS', seedLocalId, account }),
  /**
   * Settles a seed's open attempt, for a publish in `attestationOutcomeUnknown`, then retries that
   * publish if it runs in this tab. With no run it only updates the attempt.
   * `txHash` names the transaction, found on a block explorer or from the wallet: it is read and
   * recorded; anything but `0x` and 64 hex digits throws a `TypeError` and records nothing. It isn't
   * checked against the attempt's sender. `resend: true` gives the attempt up and sends again, which attests a second time if
   * it did land, so this is for an author who knows it didn't or accepts that.
   */
  resolveAttestationAttempt: async (
    seedLocalId: string,
    resolution: { txHash: string } | { resend: true },
    account?: import('../../helpers/seedSigner').PublishWallet,
  ) => {
    if ('txHash' in resolution && !/^0x[0-9a-fA-F]{64}$/.test(resolution.txHash)) {
      throw new TypeError(
        `resolveAttestationAttempt: txHash must be a transaction hash, 0x and 64 hex digits; got ${JSON.stringify(resolution.txHash)}`,
      )
    }
    const [attempt] = await findOpenPublishAttempts([seedLocalId])
    if (attempt) {
      await updatePublishAttempt(
        attempt.id,
        'txHash' in resolution ? { status: 'sent', txHash: resolution.txHash } : { status: 'abandoned' },
      )
    }
    // With no run the next publish reconciles from the updated attempt.
    if (hasRun(seedLocalId)) publishManager.send({ type: 'RETRY_ATTESTATIONS', seedLocalId, account })
  },
  /**
   * Settles a seed's open attestation attempts from the chain when no run is waiting on them, as a
   * retry's reconcile would: a landed transaction is recorded with `publisher` on its rows, and a
   * reverted one closes. It never sends. `running`: a publish of the seed runs or waits in this tab,
   * or another tab holds its lock; nothing was read, and `retryAttestations` settles it there.
   * `unknown`: the attempt may have landed and the chain can't say (`reason`), and it stays open;
   * `resolveAttestationAttempt` settles it by hash or gives it up. Waits for `ready()` first, so a
   * publish restore brings back counts as running.
   */
  settleAttestationAttempt: async (seedLocalId: string, publisher: string): Promise<AttestationSettleResult> => {
    // A publish restore is about to spawn isn't in publishProcesses yet; wait for it.
    await PublishManager.ready()
    return settleAttestationAttempt(seedLocalId, publisher, hasRun)
  },
  stopPublish: (seedLocalId: string) => publishManager.send({ type: 'STOP_PUBLISH', seedLocalId }),
  /**
   * Ends a publish waiting after a failed attestation (`attestationFailureRecoverable`, its direct
   * EAS twin, or `attestationOutcomeUnknown`) as `failed`, keeping its error, unlike `stopPublish`,
   * which records it `interrupted` and clears the error. It ends the run only once no attestation
   * attempt for the seed is open; otherwise the run keeps waiting and logs a warning naming the
   * attempt. From `attestationOutcomeUnknown`, `resolveAttestationAttempt` settles it; from the other
   * states, `retryAttestations` does. Read `query(seedLocalId)` to see which happened. Does nothing in any other state, or
   * when this tab has no publish for the seed.
   */
  giveUpPublish: (seedLocalId: string) => publishManager.send({ type: 'GIVE_UP', seedLocalId }),
  /**
   * The current snapshot of a seed's publish (running, or settled this session), or undefined.
   * A read only: it used to stop the publish it named, as stopPublish does without marking the row
   * or releasing the lock.
   */
  query: (seedLocalId: string) => PublishManager.getPublish(seedLocalId)?.getSnapshot(),
  stopAll: () => publishManager.send({ type: 'STOP_ALL' }),
  getPublish: (seedLocalId: string) => {
    const ctx = publishManager.getSnapshot().context
    return ctx.publishProcesses.get(seedLocalId) ?? ctx.settledPublishes.get(seedLocalId)
  },
  savePublish: (seedLocalId: string, publishProcess: ActorRefFrom<typeof publishMachine>) =>
    publishManager.send({ type: 'REQUEST_SAVE_PUBLISH', seedLocalId, publishProcess }),
  addSubscription: (seedLocalId: string, subscriptionActor: import('xstate').ActorRef<any, any>) =>
    publishManager.send({ type: 'ADD_SUBSCRIPTION', seedLocalId, newSubscription: subscriptionActor }),
  removeSubscription: (seedLocalId: string) => publishManager.send({ type: 'REMOVE_SUBSCRIPTION', seedLocalId }),
}
