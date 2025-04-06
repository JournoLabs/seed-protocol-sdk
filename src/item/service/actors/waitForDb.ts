import { EventObject, fromCallback } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { FromCallbackInput, ItemMachineContext } from '@/types'
import debug from 'debug'

const logger = debug('seedSdk:item:service:actors:waitForDb')

export const waitForDb = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(({ sendBack }) => {
  const _waitForDb = new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const appDb = BaseDb.getAppDb()
      if (appDb) {
        clearInterval(interval)
        resolve()
      }
      }, 100)
    })

    _waitForDb.then(() => {
      sendBack({ type: 'waitForDbSuccess' })
    })
  },
)
