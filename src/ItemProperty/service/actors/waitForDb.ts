import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, PropertyMachineContext } from '@/types'
import { BaseDb } from '@/db/Db/BaseDb'

export const waitForDb = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext>
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
})
