import { ClientManagerContext, FromCallbackInput, ModelClassType, SeedConstructorOptions } from '@/types'
import { fromCallback, EventObject, waitFor }                      from "xstate";
import debug                                       from 'debug'
import { setModel } from "@/stores/modelClass";
import { setArweaveDomain } from "@/helpers/ArweaveClient";
import { setupServicesEventHandlers } from "@/services/events";
import { setupAllItemsEventHandlers } from "@/events/item";
import { setupServiceHandlers } from "@/events/services";
// import { getGlobalService, } from "@/services/global/globalMachine";
// import { GlobalState } from "@/services/internal/constants";
import { isBrowser, isNode } from "@/helpers/environment";
import { BaseFileManager } from "@/helpers/FileManager/BaseFileManager";
import { BaseArweaveClient, BaseEasClient, BaseQueryClient } from "@/helpers";
import { BaseItem } from '@/Item/BaseItem'
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'


const logger = debug('seedSdk:ClientManager:initialize')

type InitEvent = {
  type: 'init'
  options: SeedConstructorOptions
}

export const platformClassesInit = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext, InitEvent>
>(({sendBack, input: {context, event}}) => {
  logger('initialize from ClientManager')
  const { isInitialized } = context
  
  if (!event || !('options' in event)) {
    throw new Error('Initialize event must include options')
  }
  
  const { options } = event

  if (isInitialized) {
    sendBack({type: 'initialized'})
    return
  }

  const _platformClassesInit = async () => {
    const { config, addresses } = options

    const BaseDb = (await import('../../db/Db/BaseDb')).BaseDb

    let FileManager: typeof BaseFileManager
    let Db: typeof BaseDb
    let QueryClient: typeof BaseQueryClient
    let ArweaveClient: typeof BaseArweaveClient
    let Item: typeof BaseItem
    let ItemProperty: typeof BaseItemProperty
    let PathResolver: typeof BasePathResolver
    let EasClient: typeof BaseEasClient

    if (isBrowser()) {
      FileManager = (await import('../../browser/helpers/FileManager')).FileManager
      Db = (await import('../../browser/db/Db')).Db
      QueryClient = (await import('../../browser/helpers/QueryClient')).QueryClient
      ArweaveClient = (await import('../../browser/helpers/ArweaveClient')).ArweaveClient
      Item = (await import('../../browser/Item/Item')).Item
      ItemProperty = (await import('../../browser/ItemProperty/ItemProperty')).ItemProperty
      PathResolver = (await import('../../browser/helpers/PathResolver')).PathResolver
      EasClient = (await import('../../browser/helpers/EasClient')).EasClient
    } else if (isNode()) {
      console.log('isNode')
      FileManager = (await import('../../node/helpers/FileManager')).FileManager
      Db = (await import('../../node/db/Db')).Db
      QueryClient = (await import('../../node/helpers/QueryClient')).QueryClient
      ArweaveClient = (await import('../../node/helpers/ArweaveClient')).ArweaveClient
      Item = (await import('../../node/Item/Item')).Item
      ItemProperty = (await import('../../node/ItemProperty/ItemProperty')).ItemProperty
      PathResolver = (await import('../../node/helpers/PathResolver')).PathResolver
      EasClient = (await import('../../node/helpers/EasClient')).EasClient
    } else {
      throw new Error(`Unable to determine environment. isBrowser()=${isBrowser()}, isNode()=${isNode()}. Platform-specific implementations could not be loaded.`)
    }
    
    if (!FileManager) {
      throw new Error('FileManager is undefined. Platform-specific FileManager could not be loaded.')
    }
    
    BaseFileManager.setPlatformClass(FileManager)
    BaseDb.setPlatformClass(Db!)
    BaseQueryClient.setPlatformClass(QueryClient!)
    BaseEasClient.setPlatformClass(EasClient!)
    BaseArweaveClient.setPlatformClass(ArweaveClient!)
    BaseItem.setPlatformClass(Item!)
    BaseItemProperty.setPlatformClass(ItemProperty!)
    BasePathResolver.setPlatformClass(PathResolver!)


    
    const { models, endpoints, arweaveDomain, dbConfig, filesDir } = config

    sendBack({ type: 'updateContext', context: { 
      models, 
      endpoints, 
      arweaveDomain, 
      addresses, 
      filesDir: filesDir || endpoints?.files,
      dbConfig,
    } })
    
    if (arweaveDomain) {
      setArweaveDomain(arweaveDomain)
    }

    for (const [key, value] of Object.entries(models)) {
      setModel(key, value as ModelClassType)
    }
    setupAllItemsEventHandlers()
    setupServicesEventHandlers()
    setupServiceHandlers()

  }

  _platformClassesInit().then(() => {
    sendBack({type: 'platformClassesReady'})
  })
})
