import { EventObject, fromCallback } from 'xstate'
import { AllItemsMachineContext, FromCallbackInput } from '@/types'

export const fetchDbData = fromCallback<
  EventObject,
  FromCallbackInput<AllItemsMachineContext>
>(
  ({ sendBack, input: { context } }) => {
    const { modelNamePlural, times } = context

    const _fetchDbData = async (): Promise<void> => { }

    _fetchDbData().then(() => {
      sendBack({ type: 'fetchDbDataSuccess' })
    })

    return () => { }
  },
)
