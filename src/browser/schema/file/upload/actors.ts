import { EventObject, fromCallback } from 'xstate'
import { uploadMachine } from '@/browser/schema/file/upload/index'

export const uploadBinaryData = fromCallback<EventObject, typeof uploadMachine>(
  ({ sendBack, receive, input }) => {},
)

export const uploadMetadata = fromCallback<EventObject, typeof uploadMachine>(
  ({ sendBack, receive, input }) => {},
)
