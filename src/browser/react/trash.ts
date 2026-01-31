import { useCallback, useEffect, useState } from 'react'
import { Item } from '@/Item/Item'
import { deleteItem } from '@/db/write/deleteItem'

export const useDeleteItem = () => {
  const [isDeletingItem, setIsDeletingItem] = useState(false)

  const destroy = useCallback(
    async (item: Item<any>) => {
      if (!item) {
        return
      }
      setIsDeletingItem(true)
      await deleteItem({ seedLocalId: item.seedLocalId })
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
