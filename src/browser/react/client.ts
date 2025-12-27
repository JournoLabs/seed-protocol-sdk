import { useGlobalServiceStatus } from "./services"
import { ClientManagerState, GlobalState } from "@/services/internal/constants"
import { getClient } from "@/client/ClientManager"
import { useSelector } from "@xstate/react"


export const useIsClientReady = () => {
  const { status, } = useGlobalServiceStatus()

  const client = getClient()

  const clientService = client.getService()

  const isClientReady = useSelector(clientService, (snapshot) => {
    return snapshot.value === ClientManagerState.IDLE
  })

  return status === GlobalState.INITIALIZED && isClientReady
}