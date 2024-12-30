import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, PublishMachineContext } from '@/types'

export const validateItemData = fromCallback<
  EventObject,
  FromCallbackInput<PublishMachineContext>
>(({ sendBack, input: { context } }) => {
  const _validateItemData = async () => {
    if (context && context.localId) {
      return true
    }
    return false
  }

  _validateItemData().then((isValid) => {
    if (isValid) {
      sendBack({ type: 'validateItemDataSuccess' })
    }
  })
})
