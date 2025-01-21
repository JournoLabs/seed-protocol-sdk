import { Endpoints, Environment, ModelClassType } from './index'
import { ActorRefFrom } from 'xstate'
import { PublishRequestData } from './seedProtocol'

export type DbServiceContext = {
  dbName: string
  dbId?: string
  dirName: string
  drizzleDb?: any
  pathToDb?: string
  pathToDir?: string
  pathToDbDir?: string
  hasFiles?: boolean
  error?: string
}

export type InternalMachineContext = {
  error?: string
  endpoints: Endpoints
  addresses: string[]
  filesDir?: string
  arweaveDomain?: string
  environment: string
  hasFiles: boolean
  seedDbService: any
  appDbService: any
  sdkDbService: any
}

export type GlobalMachineContext = {
  isInitialized?: boolean
  addedModelRecordsToDb?: boolean
  environment?: Environment
  endpoints?: Endpoints
  addresses?: string[]
  models?: { [key: string]: ModelClassType }
  internalService?: ActorRefFrom<any>
  publishItemService?: ActorRefFrom<any>
  arweaveDomain?: string
  filesDir?: string
}

export type PublishMachineContext = PublishRequestData & {
  status: string
}

export type GetSchemaForModelEvent = {
  type: 'getSchemaForModel'
  modelName: string
}

export type HydrateExistingItemEvent = {
  type: 'hydrateExistingItem'
  existingItem: any
}

export type FromCallbackInput<T, P = undefined> = {
  context: T
  event?: P
}
