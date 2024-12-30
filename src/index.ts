import { isNode } from './shared/environment'
import { enableMapSet } from 'immer'

export {
  Model,
  Property,
  ImageSrc,
  List,
  Text,
  Json,
  Relation,
} from './browser/schema'

export {
  Item,
  ItemProperty,
  useItems,
  useItem,
  useItemProperties,
  useCreateItem,
  useItemProperty,
  useDeleteItem,
  useGlobalServiceStatus,
  usePublishItem,
  usePersistedSnapshots,
  useServices,
  useService,
  getGlobalService,
} from './browser'

export { getCorrectId, BaseArweaveClient, BaseEasClient, BaseFileManager, BaseQueryClient, } from './helpers'

export {
  eventEmitter,
} from './eventBus'

enableMapSet()

export { withSeed } from '@/node/webpack'


export { client } from './client'

