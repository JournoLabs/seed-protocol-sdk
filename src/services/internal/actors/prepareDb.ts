import { BaseDb } from '@/db/Db/BaseDb'
import { EventObject, fromCallback } from 'xstate'


export const prepareDb = fromCallback<EventObject>(({ sendBack }) => {

  const _prepareDb = async (): Promise<void> => {
    if (typeof window === 'undefined') {
      return
    }

    const manager = await BaseDb.prepareDb()
    if (manager) {
      sendBack({ type: 'prepareDbSuccess', manager })
    }

  }

  _prepareDb().then(() => {
    return
  })

})
