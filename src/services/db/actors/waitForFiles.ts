import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput } from '@/types'
import { DB_WAITING_FOR_FILES_RECEIVED } from '@/services/internal/constants'
import debug from 'debug'
import { isBrowser } from '@/helpers/environment'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
const logger = debug('seedSdk:services:db:actors:waitForFiles')

export const waitForFiles = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {

  if (!isBrowser()) {
    sendBack({ type: DB_WAITING_FOR_FILES_RECEIVED })
    return
  }

  const { pathToDbDir } = context

  const _waitForFiles = async (): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const journalExists = await BaseFileManager.pathExists(
          `${pathToDbDir}/meta/_journal.json`,
        )
        if (journalExists) {
          clearInterval(interval)
          resolve()
        }
      }, 1000)
    })
  }

  _waitForFiles().then(() => {
    sendBack({ type: DB_WAITING_FOR_FILES_RECEIVED })
    return
  })
})
