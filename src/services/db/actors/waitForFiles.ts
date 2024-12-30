import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput } from '@/types'
import { DB_WAITING_FOR_FILES_RECEIVED } from '@/services/internal/constants'
import debug from 'debug'
import fs from '@zenfs/core'

const logger = debug('app:services:db:actors:waitForFiles')

export const waitForFiles = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {
  const { pathToDbDir } = context

  const _waitForFiles = async (): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const journalExists = await fs.promises.exists(
          `${pathToDbDir}/meta/_journal.json`,
        )
        if (journalExists) {
          clearInterval(interval)
          resolve()
        }
      })
    })
  }

  _waitForFiles().then(() => {
    sendBack({ type: DB_WAITING_FOR_FILES_RECEIVED })
    return
  })
})
