import { countRecordedPublishParts, Item, type IItem, type ItemPublishOptions } from '@seedprotocol/sdk'
import type { ActorRef } from 'xstate'
import type { CreatePublishOptions } from '../config'
import { PublishManager } from '../services/publishManager'
import { PublishMachineStates } from './constants'
import { ensureWalletThenPublish } from './ensureWalletThenPublish'
import { PublishRetractionError, PublishWalletMissingError, UploadNeedsConfirmError, UploadTooLargeError } from '../errors'

/**
 * States where attestation failed but the actor stays alive waiting for a `retry`
 * event (PublishManager.retryAttestations). They are not final, so a waiter has to
 * treat them as failure or it would hang.
 */
const RECOVERABLE_FAILURE_STATES = new Set([
  'attestationFailureRecoverable',
  'attestationFailureRecoverableDirectToEas',
  'attestationOutcomeUnknown',
  'retractionFailureRecoverable',
])

function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

type PublishSnapshot = {
  value: unknown
  status?: string
  context?: { error?: unknown; errorStep?: string; publishRunId?: string; expectedPublishTransactions?: number }
}

/**
 * "N of M parts are on chain" for a run of a split publish that has recorded parts (ADR 0036), read
 * from its attempt rows. Empty when none is recorded, and when the rows can't be read. M is left
 * out when the run has no estimate.
 */
async function partsOnChainNote(context: PublishSnapshot['context']): Promise<string> {
  if (!context?.publishRunId) return ''
  let recorded = 0
  try {
    recorded = await countRecordedPublishParts([context.publishRunId])
  } catch {
    return ''
  }
  if (recorded === 0) return ''
  const total = context.expectedPublishTransactions
  if (total === undefined || total < recorded) return `${recorded} ${recorded === 1 ? 'part is' : 'parts are'} on chain.`
  return `${recorded} of ${total} parts are on chain.`
}

/**
 * Resolves when a publish actor reaches `success`; rejects on `failure`, when it is
 * stopped, or when attestation fails into a state that waits for a retry.
 */
export function waitForPublishActor(actor: ActorRef<any, any>, seedLocalId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let sub: { unsubscribe(): void } | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      sub?.unsubscribe()
      if (error) reject(error)
      else resolve()
    }

    const check = (snapshot: PublishSnapshot) => {
      const value = snapshot.value as string
      // The failures a part can cause say how much of the publish is already on chain.
      if (
        value === PublishMachineStates.FAILURE ||
        value === 'attestationOutcomeUnknown' ||
        RECOVERABLE_FAILURE_STATES.has(value)
      ) {
        if (settled) return
        void partsOnChainNote(snapshot.context).then((note) => finishFailure(snapshot, note))
        return
      }
      finishFailure(snapshot, '')
    }

    const finishFailure = (snapshot: PublishSnapshot, partsNote: string) => {
      const value = snapshot.value as string
      const cause = snapshot.context?.error
      const detail = errorMessage(cause)
      if (value === PublishMachineStates.SUCCESS) {
        finish()
      } else if (value === PublishMachineStates.FAILURE) {
        // Passed through as-is, so the app can check instanceof (and show the upload estimate)
        if (
          cause instanceof UploadTooLargeError ||
          cause instanceof UploadNeedsConfirmError ||
          cause instanceof PublishWalletMissingError
        ) {
          finish(cause)
          return
        }
        const step = snapshot.context?.errorStep ? ` at ${snapshot.context.errorStep}` : ''
        finish(
          new Error(`Publish of ${seedLocalId} failed${step}: ${detail ?? 'unknown error'}${partsNote && `. ${partsNote}`}`, {
            cause,
          }),
        )
      } else if (value === 'retractionFailureRecoverable') {
        finish(
          new PublishRetractionError(
            `Revoking the retracted properties of ${seedLocalId} failed: ${detail ?? 'unknown error'}. ` +
              `The new attestations are in place; retry with PublishManager.retryAttestations('${seedLocalId}') ` +
              'to send the revocation again.',
            { cause },
          ),
        )
      } else if (value === 'attestationOutcomeUnknown') {
        finish(
          new Error(
            `${detail ?? `Publish of ${seedLocalId} can't tell whether its transaction landed.`} ` +
              (partsNote && `${partsNote} `) +
              `Publishing again could attest twice. Retry with PublishManager.retryAttestations('${seedLocalId}') ` +
              `to look again, or settle it with PublishManager.resolveAttestationAttempt('${seedLocalId}', ...).`,
            { cause },
          ),
        )
      } else if (RECOVERABLE_FAILURE_STATES.has(value)) {
        finish(
          new Error(
            `Creating attestations for ${seedLocalId} failed: ${detail ?? 'unknown error'}. ` +
              (partsNote && `${partsNote} `) +
              `Uploads are kept; retry with PublishManager.retryAttestations('${seedLocalId}').`,
            { cause },
          ),
        )
      } else if (snapshot.status === 'done' || snapshot.status === 'stopped') {
        finish(new Error(`Publish of ${seedLocalId} was stopped before it finished.`))
      }
    }

    sub = actor.subscribe({
      next: check,
      error: (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
      complete: () => check(actor.getSnapshot() as PublishSnapshot),
    })
    // subscribe() does not replay the current snapshot.
    check(actor.getSnapshot() as PublishSnapshot)
  })
}

/**
 * Publish an item and wait for it to finish: uploads to Arweave, then attestations on EAS.
 *
 * This is the executor behind the SDK's `item.publish()`. `initPublish()` registers it
 * with `setPublishExecutor`, so apps normally call `item.publish(options)` rather than
 * this. It uses the registered publish wallet (`useSeedWallet().connect`, `setPublishWallet`)
 * the same way {@link ensureWalletThenPublish} does.
 *
 * Rejects when no wallet or address is available, when the smart account still needs
 * deploying, when the seed is already publishing (in this tab or another), when an attestation
 * attempt for it is open, or when the publish fails. A publish of the seed parked after a failed
 * attestation in this tab is replaced, reusing its uploads; one parked in another tab rejects, and is
 * retried there.
 */
export async function publishItem(item: IItem<any>, options?: ItemPublishOptions): Promise<void> {
  // Held until the publish settles: an item the caller looked up without a hold would otherwise
  // unload after the grace period, mid-upload
  const held = Item.retain(item)
  try {
    await runPublishItem(item, options)
  } finally {
    if (held) item.unload()
  }
}

async function runPublishItem(item: IItem<any>, options?: ItemPublishOptions): Promise<void> {
  // Node does not auto-start the manager; createPublish waits for it to be active.
  await PublishManager.ready()
  const result = await ensureWalletThenPublish(item as any, options as CreatePublishOptions | undefined)
  switch (result.outcome) {
    case 'started':
      break
    case 'already_publishing':
      throw new Error(`Publish of ${item.seedLocalId} did not start: it is already publishing in this tab or another.`)
    case 'parked_in_other_tab':
      throw new Error(
        `Publish of ${item.seedLocalId} did not start: it is parked after a failed attestation in another tab of this app. Retry it there.`,
      )
    case 'attempt_open':
      throw new Error(
        `Publish of ${item.seedLocalId} did not start: an attestation transaction for it is still open and may land. ` +
          `Settle it with PublishManager.retryAttestations('${item.seedLocalId}') or ` +
          `PublishManager.settleAttestationAttempt('${item.seedLocalId}', publisher) first.`,
      )
    case 'no_wallet':
      throw new PublishWalletMissingError()
    case 'no_address':
      throw new Error('The publish wallet has no publisher address.')
    case 'needs_deploy':
      throw new Error('The smart account must be deployed before publishing.')
    case 'managed_not_ready':
      throw result.error
  }
  await waitForPublishActor(result.publish, item.seedLocalId)
}
