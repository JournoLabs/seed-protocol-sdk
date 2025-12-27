import { ClientManagerContext, FromCallbackInput } from "@/types/machines"
import { EventObject, fromCallback, waitFor } from "xstate"
import { getGlobalService } from "@/services/global/globalMachine"
import debug from "debug"
import { ClientManagerEvents, GlobalState } from "@/services/internal/constants"

const logger = debug('seedSdk:client:actors:globalServiceInit')

export const globalServiceInit = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext>
>(({sendBack, input: {context}}) => {


  const _globalServiceInit = async () => {
    const { endpoints, arweaveDomain, addresses } = context
    let { models } = context
    if (!models) {
      models = {}
    }

    const files = endpoints?.files

    const globalService = getGlobalService()

    console.log('globalService snapshot.value:', globalService.getSnapshot().value)

    globalService.send({
      type: 'init',
      endpoints,
      models,
      addresses,
      arweaveDomain,
      filesDir: files,
    })



    await waitFor(globalService, (snapshot) => {
      logger('snapshot.value', snapshot.value)
      return snapshot.value === GlobalState.INITIALIZED
    })
    logger('globalService initialized')
  }

  _globalServiceInit().then(() => {
    sendBack({ type: ClientManagerEvents.GLOBAL_SERVICE_READY })
  })
})