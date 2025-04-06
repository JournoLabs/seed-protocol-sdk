import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, InternalMachineContext } from '@/types'
import debug from 'debug'
import { isBrowser } from '@/helpers/environment'
import { BaseFileManager } from '@/helpers'

const logger = debug('seedSdk:services:internal:actors:waitForFiles')

export const waitForFiles = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {

  if (!isBrowser()) {
    sendBack({ type: 'filesReceived' })
    return
  }

  const { endpoints } = context

  const filesDir = endpoints.files

  const _waitForFiles = async (): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const journalExists = await BaseFileManager.pathExists(
          `${filesDir}/db/meta/_journal.json`,
        )
        if (journalExists) {
          clearInterval(interval)
          resolve()
        }
      }, 1000)
    })
  }

  _waitForFiles().then(() => {
    sendBack({ type: 'filesReceived' })
    return
  })
})
