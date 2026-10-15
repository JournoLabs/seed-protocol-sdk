import { ClientManagerState, getClient } from '@seedprotocol/sdk'
import { useSelector } from "@xstate/react"


/**
 * Whether `client.init` has finished and the client is ready (idle). SeedClientGate uses it to
 * hold back its children; call it to wait for readiness in your own components.
 */
export const useIsClientReady = () => {
  const client = getClient()

  const clientService = client.getService()

  const isClientReady = useSelector(clientService, (snapshot) => {
    return snapshot.value === ClientManagerState.IDLE
  })

  // GlobalState removed - check ClientManager state directly
  return isClientReady
}
