import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, InternalMachineContext } from '@/types'
import debug from 'debug'
import fs from '@zenfs/core'

const logger = debug('app:services:internal:actors:waitForFiles')

export const waitForFiles = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  const { endpoints } = context

  const filesDir = endpoints.files

  const _waitForFiles = async (): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const journalExists = await fs.promises.exists(
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
