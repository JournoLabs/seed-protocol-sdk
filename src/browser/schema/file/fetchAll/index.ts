import { assign, setup } from 'xstate'
import {
  fetchAllBinaryData,
  fetchAllMetadataRecords,
} from '@/browser/schema/file/fetchAll/actors'
import { Attestation } from '@/browser/gql/graphql'

type FetchAllFilesMachineContext = {
  addresses: string[]
  dbsLoaded: boolean
  filesMetadata?: Attestation[]
  filesBlobData?: any[]
}

export const fetchAllFilesMachine = setup({
  types: {
    context: {} as FetchAllFilesMachineContext,
  },
  actors: {
    fetchAllMetadataRecords,
    fetchAllBinaryData,
  },
}).createMachine({
  id: 'fetchAllFiles',
  initial: 'idle',
  context: ({ input }) =>
    ({
      ...input,
      dbsLoaded: false,
    }) as FetchAllFilesMachineContext,
  on: {
    allDbsLoaded: {
      target: '.fetchingAllMetadataRecords',
      actions: assign({
        dbsLoaded: true,
      }),
    },
  },
  states: {
    idle: {},
    fetchingAllMetadataRecords: {
      on: {
        fetchingAllMetadataRecordsSuccess: {
          target: 'fetchingAllBinaryData',
          actions: assign({
            filesMetadata: ({ event }) => event.filesMetadata,
          }),
        },
      },
      invoke: {
        src: 'fetchAllMetadataRecords',
        input: ({ context, event }) => ({ context, event }),
      },
    },
    fetchingAllBinaryData: {
      on: {
        fetchingAllBinaryDataSuccess: {
          target: 'success',
          actions: assign({
            filesBlobData: ({ event }) => event.filesBlobData,
          }),
        },
      },
      invoke: {
        src: 'fetchAllBinaryData',
        input: ({ context }) => ({ context }),
      },
    },
    success: {
      type: 'final',
    },
  },
})
