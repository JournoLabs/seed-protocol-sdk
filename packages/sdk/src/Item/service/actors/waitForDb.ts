import { EventObject, fromCallback } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { FromCallbackInput, ItemMachineContext } from '@/types'

export const waitForDb = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(({ sendBack }) => {
  const interval = setInterval(() => {
    if (BaseDb.getAppDb()) {
      clearInterval(interval)
      sendBack({ type: 'waitForDbSuccess' })
    }
  }, 100)

  // Stop polling if the item is stopped before the db is ready
  return () => clearInterval(interval)
})
