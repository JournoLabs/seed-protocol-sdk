import { ActorRefFrom, assign, setup } from 'xstate'
import { downloadMachine } from '@/browser/schema/file/download'
import { uploadMachine } from '@/browser/schema/file/upload'
import { MachineIds } from '@/services/internal/constants'

type FileSystemMachineContext = {
  addresses?: string[]
  downloads: ActorRefFrom<typeof downloadMachine>[]
  uploads: ActorRefFrom<typeof uploadMachine>[]
  files?: any[]
  filesMetadata?: any[]
}

export const fileSystemMachine = setup({
  types: {
    context: {} as FileSystemMachineContext,
  },
  actors: {},
}).createMachine({
  id: MachineIds.FILE_SYSTEM,
  initial: 'idle',
  context: ({ input }) =>
    ({
      ...input,
      fetchRequests: [],
      downloads: [],
      uploads: [],
      files: [],
    }) as FileSystemMachineContext,
  on: {
    updateFilesMetadata: {
      actions: assign({
        filesMetadata: ({ event }) => event.filesMetadata,
      }),
    },
  },
  states: {
    idle: {
      on: {
        download: {
          target: 'createDownload',
        },
        upload: {
          target: 'createUpload',
        },
        fetch: {
          target: 'createFetchFiles',
          actions: assign({
            addresses: ({ event }) => event.addresses,
          }),
        },
      },
    },
  },
})
