import { assign, setup } from 'xstate'
import {
  DB_CHECK_STATUS_EXISTS,
  DB_CHECK_STATUS_UPDATE_PATHS,
  DB_CREATING_SUCCESS,
  DB_MIGRATING_SUCCESS,
  DB_MIGRATING_WAIT,
  DB_VALIDATING_SUCCESS,
  DB_VALIDATING_WAIT,
  DB_WAITING_FOR_FILES_RECEIVED,
  DbState,
  MachineIds,
} from '../internal/constants'
import debug from 'debug'
import { DbServiceContext } from '@/types'
import { checkStatus } from '@/services/db/actors/checkStatus'
import { connectToDb } from '@/services/db/actors/connectToDb'
import { validate } from '@/services/db/actors/validate'
import { migrate } from '@/services/db/actors/migrate'
import { waitForFiles } from './actors/waitForFiles'

const logger = debug('app:services:db:machine')

const {
  CHECKING_STATUS,
  VALIDATING,
  WAITING_FOR_FILES,
  CONNECTING_TO_DB,
  MIGRATING,
} = DbState

const dbMachine = setup({
  types: {
    context: {} as Partial<DbServiceContext>,
    input: {} as Partial<DbServiceContext> | undefined,
  },
  actors: {
    checkStatus,
    validate,
    connectToDb,
    migrate,
    waitForFiles,
  },
}).createMachine({
  id: MachineIds.DB,
  initial: CHECKING_STATUS,
  context: ({ input }) => input as DbServiceContext,
  on: {
    [DB_WAITING_FOR_FILES_RECEIVED]: {
      actions: assign({
        hasFiles: ({ event }) => {
          logger('[db/machine] DB_WAITING_FOR_FILES_RECEIVED event:', event)
          return true
        },
      }),
    },
    updateHasFiles: {
      target: `.${CHECKING_STATUS}`,
      actions: assign({
        hasFiles: ({ context, event }) => {
          logger('[db/machine] updateHasFiles event:', event)
          logger('[db/machine] updateHasFiles context:', context)
          return event.hasFiles
        },
      }),
    },
  },
  // always: {
  //   target: `.${CHECKING_STATUS}`,
  //   guard: ({ context, event }) => context.hasFiles && event.type === 'updateHasFiles',
  // },
  states: {
    idle: {
      on: {
        start: CHECKING_STATUS,
      },
      meta: {
        displayText: 'DB starting ...',
        percentComplete: 0,
      },
    },
    [CHECKING_STATUS]: {
      on: {
        [DB_CHECK_STATUS_UPDATE_PATHS]: {
          actions: assign({
            pathToDb: ({ event }) => event.pathToDb,
            pathToDir: ({ event }) => event.pathToDir,
            pathToDbDir: ({ event }) => event.pathToDbDir,
          }),
        },
        [DB_CHECK_STATUS_EXISTS]: CONNECTING_TO_DB,
      },
      invoke: {
        src: 'checkStatus',
        input: ({ context, event }) => ({ context, event }),
      },
      meta: {
        displayText: 'Checking DB status',
        percentComplete: 60,
      },
    },
    [CONNECTING_TO_DB]: {
      on: {
        [DB_CREATING_SUCCESS]: {
          target: VALIDATING,
          actions: assign({
            dbId: ({ event }) => event.dbId,
          }),
        },
      },
      invoke: {
        src: 'connectToDb',
        input: ({ context }) => ({ context }),
      },
      meta: {
        displayText: 'Connecting to local DB',
        percentComplete: 70,
      },
    },
    [VALIDATING]: {
      on: {
        [DB_VALIDATING_SUCCESS]: {
          target: MIGRATING,
          // guard: ({ context }) => context.hasFiles,
        },
        [DB_VALIDATING_WAIT]: {
          target: WAITING_FOR_FILES,
          // guard: ({ context }) => !context.hasFiles,
        },
      },
      invoke: {
        src: 'validate',
        input: ({ context }) => ({ context }),
      },
      meta: {
        displayText: 'Validating DB',
        percentComplete: 80,
      },
    },
    // Here we're waiting for migration and schema files to be downloaded
    [WAITING_FOR_FILES]: {
      on: {
        [DB_WAITING_FOR_FILES_RECEIVED]: {
          target: MIGRATING,
          actions: assign({
            hasFiles: true,
          }),
        },
        [DB_MIGRATING_SUCCESS]: 'ready',
      },
      invoke: {
        src: 'waitForFiles',
        input: ({ context }) => ({ context }),
      },
    },
    [MIGRATING]: {
      on: {
        [DB_MIGRATING_WAIT]: WAITING_FOR_FILES,
        [DB_MIGRATING_SUCCESS]: {
          target: 'ready',
        },
      },
      invoke: {
        src: 'migrate',
        input: ({ context }) => ({ context }),
      },
      meta: {
        displayText: 'Migrating DB',
        percentComplete: 90,
      },
    },
    ready: {
      target: 'idle',
      meta: {
        displayText: 'Wrapping up the db ...',
        percentComplete: 100,
      },
    },
  },
})

export { dbMachine }
