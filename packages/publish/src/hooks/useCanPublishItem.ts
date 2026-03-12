import { useState, useEffect } from 'react'
import { isItemOwned } from '@seedprotocol/sdk'
import type { Item } from '@seedprotocol/sdk'

export function useCanPublishItem(item: Item<any> | null | undefined): boolean {
  const [canPublish, setCanPublish] = useState(true)

  useEffect(() => {
    if (!item) {
      setCanPublish(false)
      return
    }
    isItemOwned(item)
      .then(setCanPublish)
      .catch(() => setCanPublish(false))
  }, [item?.seedLocalId])

  return canPublish
}
