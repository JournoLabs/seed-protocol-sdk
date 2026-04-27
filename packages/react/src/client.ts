import { ClientManagerState, getClient } from '@seedprotocol/sdk'
import { useSelector } from "@xstate/react"


export const useIsClientReady = () => {
  const client = getClient()

  const clientService = client.getService()

  const isClientReady = useSelector(clientService, (snapshot) => {
    return snapshot.value === ClientManagerState.IDLE
  })

  // GlobalState removed - check ClientManager state directly
  return isClientReady
}
