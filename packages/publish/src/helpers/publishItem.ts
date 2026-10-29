import { Item, type IItem, type ItemPublishOptions } from '@seedprotocol/sdk'
import type { ActorRef } from 'xstate'
import type { CreatePublishOptions } from '../config'
import { PublishManager } from '../services/publishManager'
import { PublishMachineStates } from './constants'
import { ensureWalletThenPublish } from './ensureWalletThenPublish'
import { PublishRetractionError, UploadNeedsConfirmError, UploadTooLargeError } from '../errors'

/**
 * States where attestation failed but the actor stays alive waiting for a `retry`
 * event (PublishManager.retryAttestations). They are not final, so a waiter has to
 * treat them as failure or it would hang.
 */
const RECOVERABLE_FAILURE_STATES = new Set([
  'attestationFailureRecoverable',
  'attestationFailureRecoverableDirectToEas',
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
  context?: { error?: unknown; errorStep?: string }
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
      const cause = snapshot.context?.error
      const detail = errorMessage(cause)
      if (value === PublishMachineStates.SUCCESS) {
        finish()
      } else if (value === PublishMachineStates.FAILURE) {
        // Passed through as-is, so the app can check instanceof and show the estimate they carry
        if (cause instanceof UploadTooLargeError || cause instanceof UploadNeedsConfirmError) {
          finish(cause)
          return
        }
        const step = snapshot.context?.errorStep ? ` at ${snapshot.context.errorStep}` : ''
        finish(new Error(`Publish of ${seedLocalId} failed${step}: ${detail ?? 'unknown error'}`, { cause }))
      } else if (value === 'retractionFailureRecoverable') {
        finish(
          new PublishRetractionError(
            `Revoking the retracted properties of ${seedLocalId} failed: ${detail ?? 'unknown error'}. ` +
              `The new attestations are in place; retry with PublishManager.retryAttestations('${seedLocalId}') ` +
              'to send the revocation again.',
            { cause },
          ),
        )
      } else if (RECOVERABLE_FAILURE_STATES.has(value)) {
        finish(
          new Error(
            `Creating attestations for ${seedLocalId} failed: ${detail ?? 'unknown error'}. ` +
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
 * deploying, when the seed is already publishing (in this tab or another), or when the
 * publish fails.
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
    case 'no_wallet':
      throw new Error(
        'No publish wallet is connected. Connect one (useSeedWallet().connect, or setPublishWallet) before publishing.',
      )
    case 'no_address':
      throw new Error('The publish wallet has no publisher address.')
    case 'needs_deploy':
      throw new Error('The smart account must be deployed before publishing.')
    case 'managed_not_ready':
      throw result.error
  }
  await waitForPublishActor(result.publish, item.seedLocalId)
}
