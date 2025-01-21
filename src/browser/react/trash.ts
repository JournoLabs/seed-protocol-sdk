import { useCallback, useEffect, useState } from 'react'
import { Item } from '@/browser/Item/Item'
import { eventEmitter } from '@/eventBus'
import { deleteItem } from '@/db/write/deleteItem'

export const useDeleteItem = () => {
  const [isDeletingItem, setIsDeletingItem] = useState(false)

  const destroy = useCallback(
    async (item: Item<any>) => {
      if (!item) {
        return
      }
      setIsDeletingItem(true)
      const { modelName } = item.getService().getSnapshot().context
      await deleteItem({ seedLocalId: item.seedLocalId })
      eventEmitter.emit('item.requestAll', { modelName })
      setIsDeletingItem(false)
    },
    [isDeletingItem],
  )

  useEffect(() => { }, [])

  return {
    deleteItem: destroy,
    isDeletingItem,
  }
}
