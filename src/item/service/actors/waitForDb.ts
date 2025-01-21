import { EventObject, fromCallback } from 'xstate'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import { BaseDb } from '@/db/Db/BaseDb'

export const waitForDb = fromCallback<EventObject, typeof itemMachineSingle>(
  ({ sendBack }) => {
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
