import { assign, setup } from 'xstate'
import {
  fetchBinaryData,
  fetchMetadata,
} from '@/helpers/file/download/actors'

type DownloadMachineContext = {
  addresses: string[]
  fileName?: string
  metadata?: any
  binaryData?: any
  metadataServiceUrl?: string
  blobServiceUrl?: string
}

type DownloadMachineEvents =
  | { type: 'fetchingMetadataSuccess'; metadataRecords: any }
  | { type: 'fetchingBinaryDataSuccess'; data?: any }

export const downloadMachine = setup({
  types: {
    context: {} as DownloadMachineContext,
    events: {} as DownloadMachineEvents,
  },
  actors: {
    fetchMetadata,
    fetchBinaryData,
  },
}).createMachine({
  id: 'download',
  initial: 'fetchingMetadata',
  context: ({ input }) => input as DownloadMachineContext,
  states: {
    idle: {},
    fetchingMetadata: {
      on: {
        fetchingMetadataSuccess: {
          target: 'fetchingBinaryData',
          actions: assign({
            metadata: ({ event }) => event.metadataRecords,
          }),
        },
      },
      invoke: {
        src: 'fetchMetadata',
        input: ({ context }) => ({ context }),
      },
    },
    fetchingBinaryData: {
      on: {
        fetchingBinaryDataSuccess: {
          target: 'idle',
          actions: assign({
            binaryData: ({ event }) => event.data,
          }),
        },
      },
      invoke: {
        src: 'fetchBinaryData',
        input: ({ context }) => ({ context }),
      },
    },
  },
})
