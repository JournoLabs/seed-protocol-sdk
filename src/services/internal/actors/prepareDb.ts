import { BaseDb } from '@/db/Db/BaseDb'
import { isBrowser } from '@/helpers/environment'
import { InternalMachineContext } from '@/types'
import { FromCallbackInput } from '@/types'
import { EventObject, fromCallback } from 'xstate'


export const prepareDb = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  const { filesDir, } = context

  if (!filesDir) {
    throw new Error('filesDir is required')
  }

  const _prepareDb = async (): Promise<void> => {
    if (
      !BaseDb.PlatformClass || 
      !BaseDb.PlatformClass.prepareDb ||
      typeof BaseDb.PlatformClass.prepareDb !== 'function'
    ) {
      throw new Error('prepareDb is not a method on BaseDb')
    }

    const appDb = await BaseDb.prepareDb(filesDir)
    if (appDb) {
      sendBack({ type: 'prepareDbSuccess'})
    }

  }

  _prepareDb().then(() => {
    return
  })

})
