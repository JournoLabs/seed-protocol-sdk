import { setup } from 'xstate'
import { validateItemData } from './actors/validateItemData'
import { PublishMachineStates } from '@/services/internal/constants'
import { PublishMachineContext } from '@/types'
import { createPublishAttempt } from './actors/createPublishAttempt'
import { updateMachineContext } from '@/helpers/updateMachineContext'
import { preparePublishRequestData } from '@/services/publish/actors/preparePublishRequestData'
import { upload } from '@/services/publish/actors/upload'

const {
  VALIDATING_ITEM_DATA,
  CREATING_PUBLISH_ATTEMPT,
  PREPARING_PUBLISH_REQUEST_DATA,
  UPLOADING,
  PUBLISHING,
  IDLE,
} = PublishMachineStates

export const publishMachine = setup({
  types: {
    context: {} as PublishMachineContext,
    input: {} as PublishMachineContext,
  },
  actors: {
    validateItemData,
    createPublishAttempt,
    upload,
    preparePublishRequestData,
  },
}).createMachine({
  id: 'publish',
  initial: VALIDATING_ITEM_DATA,
  context: ({ input }) => input,
  on: {
    updateContext: updateMachineContext,
  },
  states: {
    [VALIDATING_ITEM_DATA]: {
      on: {
        validateItemDataSuccess: [CREATING_PUBLISH_ATTEMPT],
      },
      invoke: {
        src: 'validateItemData',
        input: ({ context }) => ({ context }),
      },
    },
    [CREATING_PUBLISH_ATTEMPT]: {
      on: {
        createPublishAttemptSuccess: [UPLOADING],
      },
      invoke: {
        src: 'createPublishAttempt',
        input: ({ context }) => ({ context }),
      },
    },
    [UPLOADING]: {
      on: {
        uploadingSuccess: [PREPARING_PUBLISH_REQUEST_DATA],
      },
      invoke: {
        src: 'upload',
        input: ({ context }) => ({ context }),
      },
    },
    [PREPARING_PUBLISH_REQUEST_DATA]: {
      on: {
        preparePublishRequestDataSuccess: [UPLOADING],
      },
      invoke: {
        src: 'preparePublishRequestData',
        input: ({ context }) => ({ context }),
      },
    },
    [PUBLISHING]: {},
    [IDLE]: {},
  },
})
