import { ClientManagerContext, FromCallbackInput } from "@/types/machines"
import { EventObject, fromCallback, waitFor } from "xstate"
import { getGlobalService } from "@/services/global/globalMachine"
import { setModel } from "@/stores/modelClass"
import { ModelClassType } from "@/types/model"
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
    const {Image} = await import('@/schema/image/model')
    if (!models) {
      models = {}
    }
    models['Image'] = Image

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

    const { models: internalModels } = await import('@/db/configs/seed.schema.config')
    for (const [key, value] of Object.entries(internalModels)) {
      setModel(key, value as unknown as ModelClassType)
    }

    setModel('Image', Image as unknown as ModelClassType)
    console.log('globalService snapshot.value:', globalService.getSnapshot().value)
    console.log('waitFor globalService')
    globalService.subscribe((snapshot) => {
      console.log('globalService snapshot.value:', snapshot.value)
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