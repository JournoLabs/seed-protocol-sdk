import { EventObject, fromCallback } from 'xstate'
import { itemMachineSingle } from '@/browser/item/single/itemMachineSingle'

import { getAppDb } from '@/browser/db/sqlWasmClient'

export const waitForDb = fromCallback<EventObject, typeof itemMachineSingle>(
  ({ sendBack }) => {
    const _waitForDb = new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const appDb = getAppDb()

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
