import { setup } from 'xstate'
import {
  uploadBinaryData,
  uploadMetadata,
} from '@/browser/schema/file/upload/actors'

export const uploadMachine = setup({
  actors: {
    uploadBinaryData,
    uploadMetadata,
  },
}).createMachine({
  id: 'upload',
  initial: 'idle',
  context: {
    file: '',
  },
  states: {
    idle: {},
  },
})
