import type { Account } from 'thirdweb/wallets'
import type { ActorRefFrom } from 'xstate'
import { setup, assign } from 'xstate'
import {
  ArweaveTransactionInfo,
  PublishMachineContext,
  ReimbursementResponse,
  PublishUpload,
}                                                                                            from '../../types'
import {
  createArweaveTransactions,
  createArweaveDataItems,
  createAttestations,
  createAttestationsDirectToEas,
  sendReimbursementRequest,
  pollForConfirmation,
  uploadData,
  uploadViaBundler,
  checking,
} from './actors'
import {
  PublishMachineStates,
} from '~/helpers/constants'
import { getPublishConfig } from '~/config'


const {
  SUCCESS,
  FAILURE,
} = PublishMachineStates

/** Extract error from event. Supports event.error (custom events like uploadError) and event.data (XState fromPromise invoke errors). */
function getErrorFromEvent(event: unknown): unknown {
  const e = event as { error?: unknown; data?: unknown }
  return e.error ?? e.data
}

export const publishMachine = setup({
  types : {
    context : {} as Partial<PublishMachineContext>,
    input   : {} as Partial<PublishMachineContext> | undefined,
  },
  actors : {
    createArweaveTransactions,
    createArweaveDataItems,
    sendReimbursementRequest,
    pollForConfirmation,
    uploadData,
    uploadViaBundler,
    createAttestations,
    createAttestationsDirectToEas,
    checking,
  },
  actions : {
    /** Log error; error/errorStep are assigned per transition. Supports both event.error (custom events) and event.data (XState fromPromise invoke errors). */
    handleError : ( { event, }, ) => {
      const err = getErrorFromEvent(event,)
      if (err != null) {
        console.error(err,)
      } else {
        console.error('Unknown error (full event):', event,)
      }
    },
    assignErrorCreatingArweaveTransactions : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'creatingArweaveTransactions',
    },),
    assignErrorCreatingArweaveDataItems : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'creatingArweaveDataItems',
    },),
    assignErrorSendingReimbursementRequest : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'sendingReimbursementRequest',
    },),
    assignErrorPollingForConfirmation : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'pollingForConfirmation',
    },),
    assignErrorUploadingData : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'uploadingData',
    },),
    assignErrorUploadingViaBundler : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'uploadingViaBundler',
    },),
    assignErrorCreatingAttestations : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'creatingAttestations',
    },),
    assignErrorCreatingAttestationsDirectToEas : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'creatingAttestationsDirectToEas',
    },),
    assignAccountFromRetry : assign({
      account : ( { event, }, ) => (event as { account?: Account }).account,
    },),
    assignErrorNotOwner : assign({
      error     : () => new Error('Item is read-only: you do not own this item. Only the publisher can publish.'),
      errorStep : () => 'checking',
    },),
    assignErrorValidationFailed : assign({
      error     : ( { event, }, ) => {
        const ev = event as { errors?: Array<{ field?: string; message: string }> }
        const errors = ev.errors ?? []
        const message = errors.length > 0
          ? `Validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${errors.map((e) => e.message).join('\n')}`
          : 'Validation failed'
        const err = new Error(message) as Error & { validationErrors?: typeof errors }
        err.validationErrors = errors
        return err
      },
      errorStep : () => 'checking',
    },),
  },

},).createMachine({
  id      : 'publish',
  initial : 'checking',
  context : ( { input, }, ) => input as PublishMachineContext,
  states  : {
    checking : {
      on: {
        notOwner: {
          target: FAILURE,
          actions: ['assignErrorNotOwner', 'handleError'],
        },
        validationFailed: {
          target: FAILURE,
          actions: ['assignErrorValidationFailed', 'handleError'],
        },
        redundantPublishProcess: {
          target: 'stopping',
        },
        validPublishProcess: {
          target: 'creatingArweaveTransactions',
        },
        validPublishProcessBundler: {
          target: 'creatingArweaveDataItems',
        },
        skipArweave: [
          {
            guard: () => getPublishConfig().useDirectEas,
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              arweaveTransactions: () => [],
              publishUploads: () => [],
            }),
          },
          {
            guard: () => !getPublishConfig().useDirectEas,
            target: 'creatingAttestations',
            actions: assign({
              arweaveTransactions: () => [],
              publishUploads: () => [],
            }),
          },
        ],
      },
      invoke : {
        src    : 'checking',
        input  : ( { context } ) => ({ context } as { context: PublishMachineContext }),
      },
    },
    creatingArweaveTransactions : {
      invoke : {
        src    : 'createArweaveTransactions',
        input  : ( { context, event } ) => ({ context, event } as { context: PublishMachineContext; event: unknown }),
        onDone : {
          target  : 'sendingReimbursementRequest',
          actions : assign({
            arweaveTransactions : ( { event, }, ) => event.output.arweaveTransactions as ArweaveTransactionInfo[],
            publishUploads : ( { event, }, ) => event.output.publishUploads as PublishUpload[],
          },),
        },
        onError : {
          target  : 'failure',
          actions : [ 'assignErrorCreatingArweaveTransactions', 'handleError', ],
        },
      },
    },
    creatingArweaveDataItems : {
      invoke : {
        src    : 'createArweaveDataItems',
        input  : ( { context, event } ) => ({ context, event } as { context: PublishMachineContext; event: unknown }),
        onDone : {
          target  : 'uploadingViaBundler',
          actions : assign({
            arweaveTransactions : ( { event, }, ) => event.output.arweaveTransactions as ArweaveTransactionInfo[],
            publishUploads : ( { event, }, ) => event.output.publishUploads as PublishUpload[],
            arweaveUploadData : ( { event, }, ) => (event.output as { arweaveUploadData?: unknown }).arweaveUploadData,
            signedDataItems : ( { event, }, ) => (event.output as { signedDataItems?: { id: string; raw: Uint8Array }[] }).signedDataItems,
          },),
        },
        onError : {
          target  : 'failure',
          actions : [ 'assignErrorCreatingArweaveDataItems', 'handleError', ],
        },
      },
    },
    sendingReimbursementRequest : {
      invoke : {
        src    : 'sendReimbursementRequest',
        input  : ( { context, event } ) => ({ context, event } as { context: PublishMachineContext; event: unknown }),
        onDone : {
          target  : 'pollingForConfirmation',
          actions : assign({
            requestResponse            : ( { event, }, ) => event.output as ReimbursementResponse,
            reimbursementTransactionId : ( { event, }, ) => (event.output as ReimbursementResponse).transactionId as string,
          },),
        },
        onError : {
          target  : 'failure',
          actions : [ 'assignErrorSendingReimbursementRequest', 'handleError', ],
        },
      },
    },
    pollingForConfirmation : {
      invoke : {
        src    : 'pollForConfirmation',
        input  : ( { context, event } ) => ({ context, event } as { context: PublishMachineContext; event: unknown }),
        onDone : {
          target  : 'uploadingData',
          actions : assign({
            reimbursementConfirmed : true,
          },),
        },
        onError : {
          target  : 'failure',
          actions : [ 'assignErrorPollingForConfirmation', 'handleError', ],
        },
      }
    },
    uploadingViaBundler : {
      on : {
        uploadComplete : [
          {
            guard: () => getPublishConfig().useDirectEas,
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              completionPercentage: 100,
            }),
          },
          {
            guard: () => !getPublishConfig().useDirectEas,
            target: 'creatingAttestations',
            actions: assign({
              completionPercentage: 100,
            }),
          },
        ],
        uploadError : {
          target  : 'failure',
          actions : [ 'assignErrorUploadingViaBundler', 'handleError', ],
        },
      },
      invoke : {
        src   : 'uploadViaBundler',
        input : ( { context } ) => ({ context }) as { context: PublishMachineContext },
      },
    },
    uploadingData : {
      on : {
        updatePercentage : {
          actions : assign({
            completionPercentage : ( { event, }, ) => {
              const ev = event as { completionPercentage?: number }
              return ev.completionPercentage as number
            },
            uploaderState : ( { event, }, ) =>
              (event as { uploaderState?: PublishMachineContext['uploaderState'] }).uploaderState,
            currentTransactionIndex : ( { event, }, ) =>
              (event as { currentTransactionIndex?: number }).currentTransactionIndex,
          },),
        },
        uploadComplete : [
          {
            guard: () => getPublishConfig().useDirectEas,
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              completionPercentage: 100,
            }),
          },
          {
            guard: () => !getPublishConfig().useDirectEas,
            target: 'creatingAttestations',
            actions: assign({
              completionPercentage: 100,
            }),
          },
        ],
        uploadError : {
          target  : 'failure',
          actions : [ 'assignErrorUploadingData', 'handleError', ],
        },
      },
      invoke : {
        src   : 'uploadData',
        input : ( { context } ) => ({ context }) as { context: PublishMachineContext },
      },
    },
    creatingAttestations : {
      invoke : {
        src    : 'createAttestations',
        input  : ( { context, event } ) => ({ context, event } as { context: PublishMachineContext; event: unknown }),
        onDone : {
          target : SUCCESS,
          actions : assign({
            easPayload : ( { event, }, ) => (event.output as { easPayload?: unknown })?.easPayload,
          },),
        },
        onError : {
          target  : 'attestationFailureRecoverable',
          actions : [ 'assignErrorCreatingAttestations', 'handleError', ],
        },
      },
    },
    attestationFailureRecoverable : {
      on : {
        retry : {
          target  : 'creatingAttestations',
          actions : [ 'assignAccountFromRetry', ],
        },
      },
    },
    creatingAttestationsDirectToEas : {
      invoke : {
        src    : 'createAttestationsDirectToEas',
        input  : ( { context, event } ) => ({ context, event } as { context: PublishMachineContext; event: unknown }),
        onDone : {
          target : SUCCESS,
          actions : assign({
            easPayload : ( { event, }, ) => (event.output as { easPayload?: unknown })?.easPayload,
          },),
        },
        onError : {
          target  : 'attestationFailureRecoverableDirectToEas',
          actions : [ 'assignErrorCreatingAttestationsDirectToEas', 'handleError', ],
        },
      },
    },
    attestationFailureRecoverableDirectToEas : {
      on : {
        retry : {
          target  : 'creatingAttestationsDirectToEas',
          actions : [ 'assignAccountFromRetry', ],
        },
      },
    },
    stopping: {
      entry: ( { context }: { context: Partial<PublishMachineContext> } ) => {
        console.log(`Actor for ${context.item?.seedLocalId} stopped`,)
      },
      type: 'final',
    },
    [SUCCESS] : {
      type : 'final',
    },
    [FAILURE] : {
      type : 'final',
    },
  },
})

export type PublishActor = ActorRefFrom<typeof publishMachine>
