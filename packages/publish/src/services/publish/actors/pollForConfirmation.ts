import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { getArweave } from '~/helpers/blockchain'

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

export type WaitForConfirmationOptions = {
  intervalMs?: number
  /** Give up after this long. Default 30 min: Arweave usually confirms within minutes. */
  timeoutMs?: number
  /** Give up after this many failed status requests in a row (default 12, about a minute). */
  maxConsecutiveErrors?: number
}

/**
 * Polls `getStatus` until it reports `confirmed`. Rejects on timeout, or with the last error once
 * the status request has failed `maxConsecutiveErrors` times in a row; a success resets the count.
 */
export function waitForArweaveConfirmation(
  getStatus: () => Promise<{ confirmed?: unknown } | null | undefined>,
  label: string,
  { intervalMs = 5000, timeoutMs = 30 * 60_000, maxConsecutiveErrors = 12 }: WaitForConfirmationOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    let consecutiveErrors = 0
    const poll = async () => {
      try {
        const response = await getStatus()
        consecutiveErrors = 0
        if (response && response.confirmed) {
          resolve()
          return
        }
      } catch (error) {
        consecutiveErrors += 1
        if (consecutiveErrors >= maxConsecutiveErrors) {
          reject(
            new Error(`Checking confirmation of ${label} failed ${consecutiveErrors} times in a row`, { cause: error }),
          )
          return
        }
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`${label} was not confirmed within ${Math.round(timeoutMs / 60_000)} min`))
        return
      }
      setTimeout(poll, intervalMs)
    }
    setTimeout(poll, intervalMs)
  })
}

export const pollForConfirmation = fromPromise(async ({ input: { context } }: PublishInput): Promise<void> => {
  const { requestResponse, reimbursementTransactionId } = context

  if (!requestResponse) {
    throw new Error('No request response')
  }

  if (!reimbursementTransactionId) {
    throw new Error('No reimbursement transaction id')
  }

  const arweave = getArweave()
  await waitForArweaveConfirmation(
    () => arweave.transactions.getStatus(reimbursementTransactionId),
    `Reimbursement transaction ${reimbursementTransactionId}`,
  )
})
