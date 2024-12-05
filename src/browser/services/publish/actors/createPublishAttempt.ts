import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, PublishMachineContext } from '@/types'

export const createPublishAttempt = fromCallback<
  EventObject,
  FromCallbackInput<PublishMachineContext>
>(({ sendBack, input: { context } }) => {
  const _createPublishAttempt = async () => {
    // Do some stuff
    return true
  }

  _createPublishAttempt().then(() => {
    sendBack({ type: 'createPublishAttemptSuccess' })
  })
})
