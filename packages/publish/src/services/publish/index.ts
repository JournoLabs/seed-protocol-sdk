import { setup, assign, } from 'xstate'
import {
  ArweaveTransactionInfo,
  PublishMachineContext,
}                                                                                            from '~/types/types'
import {
  createArweaveTransactions,
  createAttestations,
  sendReimbursementRequest,
  pollForConfirmation,
  uploadData,
} from './actors'
import { checking, } from './actors/checking'
import { ReimbursementResponse, } from '../upload'
import {
  PublishMachineStates,
} from '~/helpers/constants'
import { PublishUpload } from '@seedprotocol/sdk'


const {
  SUCCESS,
  FAILURE,
} = PublishMachineStates

export const publishMachine = setup({
  types : {
    context : {} as Partial<PublishMachineContext>,
    input   : {} as Partial<PublishMachineContext> | undefined,
  },
  actors : {
    createArweaveTransactions,
    sendReimbursementRequest,
    pollForConfirmation,
    uploadData,
    createAttestations,
    checking,
  },
  actions : {
    /** Log error; error/errorStep are assigned per transition. */
    handleError : ( { event, }, ) => {
      console.error(event.error,)
    },
    assignErrorCreatingArweaveTransactions : assign({
      error     : ( { event, }, ) => event.error,
      errorStep : () => 'creatingArweaveTransactions',
    },),
    assignErrorSendingReimbursementRequest : assign({
      error     : ( { event, }, ) => event.error,
      errorStep : () => 'sendingReimbursementRequest',
    },),
    assignErrorPollingForConfirmation : assign({
      error     : ( { event, }, ) => event.error,
      errorStep : () => 'pollingForConfirmation',
    },),
    assignErrorUploadingData : assign({
      error     : ( { event, }, ) => event.error,
      errorStep : () => 'uploadingData',
    },),
    assignErrorCreatingAttestations : assign({
      error     : ( { event, }, ) => event.error,
      errorStep : () => 'creatingAttestations',
    },),
  },

},).createMachine({
  id      : 'publish',
  initial : 'checking',
  context : ( { input, }, ) => input as PublishMachineContext,
  states  : {
    checking : {
      on: {
        redundantPublishProcess: {
          target: 'stopping',
        },
        validPublishProcess: {
          target: 'creatingArweaveTransactions',
        },
        skipArweave: {
          target: 'creatingAttestations',
          actions: assign({
            arweaveTransactions: () => [],
            publishUploads: () => [],
          }),
        },
      },
      invoke : {
        src    : 'checking',
        input  : ( { context, }, ) => ({ context, }),
      },
    },
    creatingArweaveTransactions : {
      invoke : {
        src    : 'createArweaveTransactions',
        input  : ( { context, event, }, ) => ({ context, event, }),
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
    sendingReimbursementRequest : {
      invoke : {
        src    : 'sendReimbursementRequest',
        input  : ( { context, event, }, ) => ({ context, event, }),
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
        input  : ( { context, event, }, ) => ({ context, event, }),
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
    uploadingData : {
      on : {
        updatePercentage : {
          actions : assign({
            completionPercentage : ( { event, }, ) => {
              console.log('updatePercentage', event,)
              return event.percentage as number

            },
          },),
        },
        uploadComplete : {
          target  : 'creatingAttestations',
          actions : assign({
            completionPercentage : 100,
          },),
        },
        uploadError : {
          target  : 'failure',
          actions : [ 'assignErrorUploadingData', 'handleError', ],
        },
      },
      invoke : {
        src   : 'uploadData',
        input : ( { context, }, ) => ({ context, }),
      },
    },
    creatingAttestations : {
      invoke : {
        src    : 'createAttestations',
        input  : ( { context, event, }, ) => ({ context, event, }),
        onDone : {
          target : SUCCESS,
        },
        onError : {
          target  : FAILURE,
          actions : [ 'assignErrorCreatingAttestations', 'handleError', ],
        },
      },
    },
    stopping: {
      entry: ( { context, }: { context: Partial<PublishMachineContext> }, ) => {
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
},)


