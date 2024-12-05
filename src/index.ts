import { isNode } from './shared/environment'
import { initSeedSync } from './init'
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
  useServices,
  getGlobalService,
  client,
} from './browser'

export { getCorrectId } from './browser/helpers'

enableMapSet()

let withSeed

if (isNode()) {
  withSeed = initSeedSync()?.withSeed
}

export { withSeed }
