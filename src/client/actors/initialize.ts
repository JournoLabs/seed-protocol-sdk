import { ClientManagerContext, FromCallbackInput, ModelClassType } from '@/types'
import { fromCallback, EventObject, waitFor }                      from "xstate";
import debug                                       from 'debug'
import { areFsListenersReady } from "@/events/files";
import { setModel } from "@/stores/modelClass";
import { setArweaveDomain } from "@/helpers/ArweaveClient";
import { eventEmitter } from "@/eventBus";
import { setupFsListeners } from "@/events/files";
import { setupServicesEventHandlers } from "@/services/events";
import { setupAllItemsEventHandlers } from "@/events/item";
import { setupServiceHandlers } from "@/events/services";
import { getGlobalService, } from "@/services/global/globalMachine";
import { GlobalState } from "@/services/internal/constants";
import { isBrowser, isNode } from "@/helpers/environment";
import { BaseFileManager } from "@/helpers/FileManager/BaseFileManager";
import { BaseArweaveClient, BaseQueryClient } from "@/helpers";
import { BaseItem } from '@/Item/BaseItem'
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty'


const logger = debug('seedSdk:ClientManager:initialize')

export const initialize = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext, EventObject>
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

    const BaseDb = (await import('../../db/Db/BaseDb')).BaseDb

    let FileManager: typeof BaseFileManager
    let Db: typeof BaseDb
    let QueryClient: typeof BaseQueryClient
    let ArweaveClient: typeof BaseArweaveClient
    let Item: typeof BaseItem
    let ItemProperty: typeof BaseItemProperty

    if (isBrowser()) {
      FileManager = (await import('../../browser/helpers/FileManager')).FileManager
      Db = (await import('../../browser/db/Db')).Db
      QueryClient = (await import('../../browser/helpers/QueryClient')).QueryClient
      ArweaveClient = (await import('../../browser/helpers/ArweaveClient')).ArweaveClient
      Item = (await import('../../browser/Item/Item')).Item
      ItemProperty = (await import('../../browser/ItemProperty/ItemProperty')).ItemProperty
    }
    
    if (isNode()) {
      FileManager = (await import('../../node/helpers/FileManager')).FileManager
      Db = (await import('../../node/db/Db')).Db
      QueryClient = (await import('../../node/helpers/QueryClient')).QueryClient
      ArweaveClient = (await import('../../node/helpers/ArweaveClient')).ArweaveClient
      Item = (await import('../../node/Item/Item')).Item
      ItemProperty = (await import('../../node/ItemProperty/ItemProperty')).ItemProperty
    }
    
    BaseFileManager.setPlatformClass(FileManager!)
    BaseDb.setPlatformClass(Db!)
    BaseQueryClient.setPlatformClass(QueryClient!)
    BaseArweaveClient.setPlatformClass(ArweaveClient!)
    BaseItem.setPlatformClass(Item!)
    BaseItemProperty.setPlatformClass(ItemProperty!)
    
    const { models, endpoints, arweaveDomain, } = config
    
    const {files} = endpoints

    await BaseDb.connectToDb(files,)

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

    const {Image} = await import('@/schema/image/model')
    models['Image'] = Image

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

    setModel('Image', Image)

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
