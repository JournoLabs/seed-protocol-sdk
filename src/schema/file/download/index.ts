import { assign, setup } from 'xstate'
import {
  fetchBinaryData,
  fetchMetadata,
} from '@/schema/file/download/actors'

type DownloadMachineContext = {
  fileName: string
  metadata: any
  binaryData: any
  metadataServiceUrl: string
  blobServiceUrl: string
}

export const downloadMachine = setup({
  types: {
    context: {} as DownloadMachineContext,
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
            metadata: (context, event) => event.metadataRecords,
          }),
        },
      },
      invoke: {
        src: 'fetchMetadata',
        input: (context) => ({ context }),
      },
    },
    fetchingBinaryData: {
      on: {
        fetchingBinaryDataSuccess: {
          target: 'idle',
          actions: assign({
            binaryData: (context, event) => event.data,
          }),
        },
      },
      invoke: {
        src: 'fetchBinaryData',
        input: (context) => ({ context }),
      },
    },
  },
})
