import { isNode } from '@/shared/environment'
import { Seed }                                     from '@/types'
import { ImageSrc, Json, List, Property, Relation } from '@/browser/schema'
import { withSeed } from '@/index'

export const initSeedSync = (): Partial<Seed> | null => {
  if (isNode()) {
    return {
      Property,
      ImageSrc,
      List,
      Text,
      Json,
      Relation,
      withSeed,
    }
  } else {
    return {
      Property,
      ImageSrc,
      Relation,
      Text,
      List,
      Json,
    }
  }
}
