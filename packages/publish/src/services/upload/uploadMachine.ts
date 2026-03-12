import { assign, setup } from 'xstate'
import { sendReimbursementRequest, uploadData } from './actors'
import type { ArweaveTransactionInfo } from '../../types'

export type ReimbursementResponse = { transactionId: string }

export type UploadMachineContext = {
  uploadTransactions: ArweaveTransactionInfo[]
  reimbursementTransactionId?: string
  reimbursementConfirmed?: boolean
  transactionKeys?: string
  requestResponse?: ReimbursementResponse
  endpoint?: string
  completionPercentage?: number
}

export const uploadMachine = setup({
  types: {
    context: {} as UploadMachineContext,
  },
  actions: {
    handleError: ({ event }) => {
      console.error((event as { error?: unknown }).error)
    },
  },
  actors: {
    sendReimbursementRequest,
    uploadData,
  },
}).createMachine({
  id: 'upload',
  initial: 'sendReimbursementRequest',
  context: ({ input }) => input as UploadMachineContext,
  states: {
    sendReimbursementRequest: {
      invoke: {
        id: 'sendReimbursementRequest',
        src: 'sendReimbursementRequest',
        input: ({ context, event }) => ({ context, event }),
        onDone: {
          target: 'pollForConfirmation',
          actions: assign({
            requestResponse: ({ event }) => event.output as ReimbursementResponse,
            reimbursementTransactionId: ({ event }) =>
              (event.output as ReimbursementResponse).transactionId as string,
          }),
        },
        onError: {
          target: 'failure',
          actions: 'handleError',
        },
      },
    },
    pollForConfirmation: {
      on: {
        confirmed: {
          target: 'uploadData',
          actions: assign({
            reimbursementConfirmed: true,
          }),
        },
      },
    },
    uploadData: {
      on: {
        updatePercentage: {
          actions: assign({
            completionPercentage: ({ event }) => (event as { completionPercentage?: number }).completionPercentage as number,
          }),
        },
        uploadComplete: {
          target: 'success',
          actions: assign({
            completionPercentage: 100,
          }),
        },
        uploadFailed: {
          target: 'failure',
          actions: 'handleError',
        },
      },
      invoke: {
        id: 'uploadData',
        src: 'uploadData',
        input: ({ context }) => ({ context }),
      },
    },
    reset: {
      target: 'sendReimbursementRequest',
    },
    success: {
      type: 'final',
    },
    failure: {
      type: 'final',
    },
  },
})
