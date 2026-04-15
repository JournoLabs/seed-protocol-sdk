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
  createArweaveTransactionsPhase2,
  createArweaveDataItems,
  createArweaveDataItemsPhase2,
  createAttestations,
  createAttestationsDirectToEas,
  sendReimbursementRequest,
  pollForConfirmation,
  uploadData,
  uploadViaBundler,
  checking,
  preparingHtmlEmbedded,
  rewritingHtmlEmbedded,
} from './actors'
import {
  PublishMachineStates,
} from '~/helpers/constants'
import { getPublishConfig } from '~/config'


const {
  SUCCESS,
  FAILURE,
} = PublishMachineStates

/** Prefer context from `checking`; fall back to `useDirectEas` for restored snapshots without `attestationStrategy`. */
function attestationUsesDirectEas(context: Partial<PublishMachineContext>): boolean {
  const s = context.attestationStrategy
  if (s === 'directEas') return true
  if (s === 'multiPublish') return false
  return getPublishConfig().useDirectEas
}

function attestationUsesMultiPublish(context: Partial<PublishMachineContext>): boolean {
  const s = context.attestationStrategy
  if (s === 'multiPublish') return true
  if (s === 'directEas') return false
  return !getPublishConfig().useDirectEas
}

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
    createArweaveTransactionsPhase2,
    createArweaveDataItems,
    createArweaveDataItemsPhase2,
    sendReimbursementRequest,
    pollForConfirmation,
    uploadData,
    uploadViaBundler,
    createAttestations,
    createAttestationsDirectToEas,
    checking,
    preparingHtmlEmbedded,
    rewritingHtmlEmbedded,
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
    assignErrorPreparingHtmlEmbedded : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'preparingHtmlEmbedded',
    },),
    assignErrorRewritingHtmlEmbedded : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'rewritingHtmlEmbedded',
    },),
    assignErrorCreatingArweaveTransactionsPhase2 : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'creatingArweaveTransactionsPhase2',
    },),
    assignErrorUploadingDataPhase2 : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'uploadingDataPhase2',
    },),
    assignErrorUploadingViaBundler : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'uploadingViaBundler',
    },),
    assignErrorCreatingArweaveDataItemsPhase2 : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'creatingArweaveDataItemsPhase2',
    },),
    assignErrorUploadingViaBundlerPhase2 : assign({
      error     : ( { event, }, ) => getErrorFromEvent(event,),
      errorStep : () => 'uploadingViaBundlerPhase2',
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
    assignErrorCheckingFailed : assign({
      error : ({ event }) => {
        const ev = event as { error?: unknown }
        const e = ev.error
        return e instanceof Error ? e : new Error(String(e ?? 'Publish check failed'))
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
        checkingFailed: {
          target: FAILURE,
          actions: ['assignErrorCheckingFailed', 'handleError'],
        },
        validPublishProcess: {
          target: 'preparingHtmlEmbedded',
          actions: assign({
            attestationStrategy: ({ event }) =>
              (event as { attestationStrategy?: PublishMachineContext['attestationStrategy'] })
                .attestationStrategy,
          }),
        },
        validPublishProcessBundler: {
          target: 'preparingHtmlEmbedded',
          actions: assign({
            attestationStrategy: ({ event }) =>
              (event as { attestationStrategy?: PublishMachineContext['attestationStrategy'] })
                .attestationStrategy,
          }),
        },
        skipArweave: [
          {
            guard: ({ context }) => attestationUsesDirectEas(context),
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              arweaveTransactions: () => [],
              publishUploads: () => [],
              attestationStrategy: ({ event }) =>
                (event as { attestationStrategy?: PublishMachineContext['attestationStrategy'] })
                  .attestationStrategy,
            }),
          },
          {
            guard: ({ context }) => attestationUsesMultiPublish(context),
            target: 'creatingAttestations',
            actions: assign({
              arweaveTransactions: () => [],
              publishUploads: () => [],
              attestationStrategy: ({ event }) =>
                (event as { attestationStrategy?: PublishMachineContext['attestationStrategy'] })
                  .attestationStrategy,
            }),
          },
        ],
      },
      invoke : {
        src    : 'checking',
        input  : ( { context } ) => ({ context } as { context: PublishMachineContext }),
      },
    },
    preparingHtmlEmbedded: {
      invoke: {
        src: 'preparingHtmlEmbedded',
        input: ({ context }) => ({ context } as { context: PublishMachineContext }),
        onDone: [
          {
            guard: () => getPublishConfig().useArweaveBundler,
            target: 'creatingArweaveDataItems',
            actions: assign({
              htmlEmbeddedDeferredHtmlSeedLocalIds: ({ event }) =>
                (event.output as { deferredHtmlSeedLocalIds: string[] }).deferredHtmlSeedLocalIds,
            }),
          },
          {
            target: 'creatingArweaveTransactions',
            actions: assign({
              htmlEmbeddedDeferredHtmlSeedLocalIds: ({ event }) =>
                (event.output as { deferredHtmlSeedLocalIds: string[] }).deferredHtmlSeedLocalIds,
            }),
          },
        ],
        onError: {
          target: FAILURE,
          actions: ['assignErrorPreparingHtmlEmbedded', 'handleError'],
        },
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
            guard: ({ context }) => attestationUsesDirectEas(context),
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              completionPercentage: 100,
              signedDataItems: () => undefined,
              arweaveUploadData: () => undefined,
            }),
          },
          {
            guard: (args) =>
              ((args.context?.htmlEmbeddedDeferredHtmlSeedLocalIds?.length ?? 0) > 0),
            target: 'rewritingHtmlEmbedded',
            actions: assign({
              htmlEmbeddedPhase1PublishUploads: ({ context }) =>
                (context.publishUploads ?? []) as PublishUpload[],
              htmlEmbeddedPhase1ArweaveTransactions: ({ context }) =>
                (context.arweaveTransactions ?? []) as ArweaveTransactionInfo[],
              signedDataItems: () => undefined,
              arweaveUploadData: () => undefined,
            }),
          },
          {
            guard: ({ context }) => attestationUsesMultiPublish(context),
            target: 'creatingAttestations',
            actions: assign({
              completionPercentage: 100,
              signedDataItems: () => undefined,
              arweaveUploadData: () => undefined,
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
    creatingArweaveDataItemsPhase2: {
      invoke: {
        src: 'createArweaveDataItemsPhase2',
        input: ({ context, event }) =>
          ({ context, event }) as { context: PublishMachineContext; event: unknown },
        onDone: {
          target: 'uploadingViaBundlerPhase2',
          actions: assign({
            arweaveTransactions: ({ event }) =>
              (event.output as { arweaveTransactions: ArweaveTransactionInfo[] }).arweaveTransactions,
            publishUploads: ({ event }) =>
              (event.output as { publishUploads: PublishUpload[] }).publishUploads,
            signedDataItems: ({ event }) =>
              (event.output as { signedDataItems?: PublishMachineContext['signedDataItems'] })
                .signedDataItems,
            uploaderState: () => undefined,
            currentTransactionIndex: () => undefined,
          }),
        },
        onError: {
          target: FAILURE,
          actions: ['assignErrorCreatingArweaveDataItemsPhase2', 'handleError'],
        },
      },
    },
    uploadingViaBundlerPhase2: {
      on: {
        uploadComplete: [
          {
            guard: ({ context }) => attestationUsesDirectEas(context),
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              completionPercentage: 100,
              signedDataItems: () => undefined,
              arweaveUploadData: () => undefined,
            }),
          },
          {
            guard: ({ context }) => attestationUsesMultiPublish(context),
            target: 'creatingAttestations',
            actions: assign({
              completionPercentage: 100,
              signedDataItems: () => undefined,
              arweaveUploadData: () => undefined,
              publishUploads: ({ context }) =>
                [
                  ...((context.htmlEmbeddedPhase1PublishUploads ?? []) as PublishUpload[]),
                  ...((context.publishUploads ?? []) as PublishUpload[]),
                ],
              arweaveTransactions: ({ context }) =>
                [
                  ...((context.htmlEmbeddedPhase1ArweaveTransactions ?? []) as ArweaveTransactionInfo[]),
                  ...((context.arweaveTransactions ?? []) as ArweaveTransactionInfo[]),
                ],
            }),
          },
        ],
        uploadError: {
          target: FAILURE,
          actions: ['assignErrorUploadingViaBundlerPhase2', 'handleError'],
        },
      },
      invoke: {
        src: 'uploadViaBundler',
        input: ({ context }) => ({ context }) as { context: PublishMachineContext },
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
            guard: ({ context }) => attestationUsesDirectEas(context),
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              completionPercentage: 100,
            }),
          },
          {
            guard: (args) =>
              ((args.context?.htmlEmbeddedDeferredHtmlSeedLocalIds?.length ?? 0) > 0),
            target: 'rewritingHtmlEmbedded',
            actions: assign({
              htmlEmbeddedPhase1PublishUploads: ({ context }) =>
                (context.publishUploads ?? []) as PublishUpload[],
              htmlEmbeddedPhase1ArweaveTransactions: ({ context }) =>
                (context.arweaveTransactions ?? []) as ArweaveTransactionInfo[],
            }),
          },
          {
            guard: ({ context }) => attestationUsesMultiPublish(context),
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
    rewritingHtmlEmbedded: {
      invoke: {
        src: 'rewritingHtmlEmbedded',
        input: ({ context }) => ({ context }) as { context: PublishMachineContext },
        onDone: [
          {
            guard: () => !getPublishConfig().useArweaveBundler,
            target: 'creatingArweaveTransactionsPhase2',
          },
          {
            guard: () => getPublishConfig().useArweaveBundler,
            target: 'creatingArweaveDataItemsPhase2',
          },
        ],
        onError: {
          target: FAILURE,
          actions: ['assignErrorRewritingHtmlEmbedded', 'handleError'],
        },
      },
    },
    creatingArweaveTransactionsPhase2: {
      invoke: {
        src: 'createArweaveTransactionsPhase2',
        input: ({ context, event }) =>
          ({ context, event }) as { context: PublishMachineContext; event: unknown },
        onDone: {
          target: 'uploadingDataPhase2',
          actions: assign({
            arweaveTransactions: ({ event }) =>
              (event.output as { arweaveTransactions: ArweaveTransactionInfo[] }).arweaveTransactions,
            publishUploads: ({ event }) =>
              (event.output as { publishUploads: PublishUpload[] }).publishUploads,
            uploaderState: () => undefined,
            currentTransactionIndex: () => undefined,
          }),
        },
        onError: {
          target: FAILURE,
          actions: ['assignErrorCreatingArweaveTransactionsPhase2', 'handleError'],
        },
      },
    },
    uploadingDataPhase2: {
      on: {
        updatePercentage: {
          actions: assign({
            completionPercentage: ({ event }) => {
              const ev = event as { completionPercentage?: number }
              return ev.completionPercentage as number
            },
            uploaderState: ({ event }) =>
              (event as { uploaderState?: PublishMachineContext['uploaderState'] }).uploaderState,
            currentTransactionIndex: ({ event }) =>
              (event as { currentTransactionIndex?: number }).currentTransactionIndex,
          }),
        },
        uploadComplete: [
          {
            guard: ({ context }) => attestationUsesDirectEas(context),
            target: 'creatingAttestationsDirectToEas',
            actions: assign({
              completionPercentage: 100,
            }),
          },
          {
            guard: ({ context }) => attestationUsesMultiPublish(context),
            target: 'creatingAttestations',
            actions: assign({
              completionPercentage: 100,
              publishUploads: ({ context }) =>
                [
                  ...((context.htmlEmbeddedPhase1PublishUploads ?? []) as PublishUpload[]),
                  ...((context.publishUploads ?? []) as PublishUpload[]),
                ],
              arweaveTransactions: ({ context }) =>
                [
                  ...((context.htmlEmbeddedPhase1ArweaveTransactions ?? []) as ArweaveTransactionInfo[]),
                  ...((context.arweaveTransactions ?? []) as ArweaveTransactionInfo[]),
                ],
            }),
          },
        ],
        uploadError: {
          target: FAILURE,
          actions: ['assignErrorUploadingDataPhase2', 'handleError'],
        },
      },
      invoke: {
        src: 'uploadData',
        input: ({ context }) => ({ context }) as { context: PublishMachineContext },
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
