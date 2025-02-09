import { initDb } from "@/db/Db";
import { initArweaveClient, setArweaveDomain } from "@/helpers/ArweaveClient";
import { initEasClient } from "@/helpers/EasClient";
import { initFileManager } from "@/helpers/FileManager";
import { initQueryClient } from "@/helpers/QueryClient";
import { initItem } from "@/Item";
import { initItemProperty } from "@/ItemProperty";
import { ClientManagerContext, FromCallbackInput } from "@/types";
import { fromCallback, EventObject, waitFor }      from "xstate";
import debug                                       from 'debug'
import { areFsListenersReady } from "@/events/files";
import { setModel } from "@/stores/modelClass";
import { setupFsListeners } from "@/events/files";
import { setupServicesEventHandlers } from "@/services/events";
import { setupAllItemsEventHandlers } from "@/events/item";
import { setupServiceHandlers } from "@/events/services";
import { eventEmitter }                    from "@/eventBus";
import { getGlobalService, } from "@/services";
import { GlobalState }                     from '@/services/internal/constants'

const logger = debug('app:ClientManager:initialize')

export const initialize = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext>
>(({sendBack, input: {context, event}}) => {
  logger('initialize from ClientManager')
  const { isInitialized } = context
  const { options, } = event

  if (isInitialized) {
    sendBack({type: 'initialized'})
    return
  }

  const _initialize = async () => {
    const { config, addresses } = options

    await initItem()
    await initItemProperty()
    await initEasClient()
    await initArweaveClient()
    await initQueryClient()
    await initFileManager()
    await initDb()

    const { models, endpoints, arweaveDomain, } = config

    const {files} = endpoints

    if (arweaveDomain) {
      setArweaveDomain(arweaveDomain)
    }

    for (const [key, value] of Object.entries(models)) {
      setModel(key, value)
    }
    setupFsListeners()
    setupAllItemsEventHandlers()
    setupServicesEventHandlers()
    setupServiceHandlers()
    if (areFsListenersReady()) {
      eventEmitter.emit('fs.init')
    }
    if (!areFsListenersReady()) {
      console.error('fs listeners not ready during init')
    }

    const globalService = getGlobalService()

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
      setModel(key, value)
    }

    await waitFor(globalService, (snapshot) => {
      logger('snapshot.value', snapshot.value)
      return snapshot.value === GlobalState.INITIALIZED
    })
    logger('globalService initialized')
  }

  _initialize().then(() => {
    sendBack({type: 'initialized'})
  })
})
