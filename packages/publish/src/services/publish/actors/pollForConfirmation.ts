import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { getArweave } from '~/helpers/blockchain'

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

export const pollForConfirmation = fromPromise(async ({ input: { context, event } }: PublishInput): Promise<void> => {
  const { requestResponse, reimbursementTransactionId } = context

  if (!requestResponse) {
    throw new Error('No request response')
  }

  if (!reimbursementTransactionId) {
    throw new Error('No reimbursement transaction id')
  }

  const arweave = getArweave()

  const _pollForConfirmation = new Promise<void>((resolve, reject) => {
    const interval = setInterval(async () => {
      let response
      try {
        response = await arweave.transactions.getStatus(reimbursementTransactionId)
      } catch (error) {
        return
      }
      if (response && response.confirmed) {
        clearInterval(interval)
        resolve()
      }
    }, 5000)
  })

  await _pollForConfirmation
})
