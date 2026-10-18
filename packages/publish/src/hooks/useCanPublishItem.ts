import { useState, useEffect } from 'react'
import { isItemOwned } from '@seedprotocol/sdk'
import type { Item } from '@seedprotocol/sdk'
import { useSeedAddressRevision } from '@seedprotocol/react'

/**
 * Whether the client's addresses own `item`, so it can be published. False until the check has
 * finished, and checked again when the item or the owned addresses change (connect, disconnect,
 * setAddresses). A check overtaken by a newer one is ignored.
 */
export function useCanPublishItem(item: Item<any> | null | undefined): boolean {
  const [canPublish, setCanPublish] = useState(false)
  const addressRevision = useSeedAddressRevision()
  const seedLocalId = item?.seedLocalId

  useEffect(() => {
    if (!item) {
      setCanPublish(false)
      return
    }
    let current = true
    setCanPublish(false)
    isItemOwned(item)
      .then((owned) => {
        if (current) setCanPublish(owned)
      })
      .catch(() => {
        if (current) setCanPublish(false)
      })
    return () => {
      current = false
    }
  }, [seedLocalId, addressRevision])

  return canPublish
}
