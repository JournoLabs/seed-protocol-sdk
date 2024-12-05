import { EventObject, fromCallback } from 'xstate'
import { createItemMachine } from '../createItemMachine'

export const createItem = fromCallback<EventObject, typeof createItemMachine>(
  ({ sendBack, input: { context, event } }) => {
    const { item } = context

    if (!item) {
      console.warn('No item found')
      return
    }

    sendBack({ type: 'itemCreated', item })
  },
)
