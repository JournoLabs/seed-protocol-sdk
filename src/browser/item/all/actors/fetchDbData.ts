import { EventObject, fromCallback } from 'xstate'
import { itemMachineAll } from '@/browser/item/all/itemMachineAll'

export const fetchDbData = fromCallback<EventObject, typeof itemMachineAll>(
  ({ sendBack, input: { context } }) => {
    const { modelNamePlural, times } = context

    const _fetchDbData = async (): Promise<void> => {}

    _fetchDbData().then(() => {
      sendBack({ type: 'fetchDbDataSuccess' })
    })

    return () => {}
  },
)
