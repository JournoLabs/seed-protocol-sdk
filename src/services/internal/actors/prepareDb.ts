import { BaseDb } from '@/db/Db/BaseDb'
import { InternalMachineContext } from '@/types'
import { FromCallbackInput } from '@/types'
import { EventObject, fromCallback } from 'xstate'


export const prepareDb = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  const { filesDir } = context

  if (!filesDir) {
    throw new Error('filesDir is required')
  }

  const _prepareDb = async (): Promise<void> => {
    const appDb = await BaseDb.prepareDb(filesDir)
    if (appDb) {
      sendBack({ type: 'prepareDbSuccess'})
    }

  }

  _prepareDb().then(() => {
    return
  })

})
