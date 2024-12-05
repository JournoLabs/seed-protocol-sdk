import { Seed } from '@/types'
import { withSeed } from '@/node'
import {
  ImageSrc,
  Json,
  List,
  Model,
  Property,
  Relation,
  Text,
} from '@/browser/schema'
import { isNode } from '@/shared/environment'
import { SeedSync } from '@/shared/seed'
import { SeedBrowser } from '@/browser/seed'

export const initSeedSync = (): Partial<Seed> | null => {
  if (isNode()) {
    return {
      Model,
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
      Model,
      Property,
      ImageSrc,
      Relation,
      Text,
      List,
      Json,
    }
  }
}

export const initSeedConstructor = async (): Promise<SeedSync> => {
  return new Promise((resolve) => {
    let Seed = null

    if (isNode()) {
      import('@/node/seed').then((seedImport) => {
        Seed = seedImport
        resolve(Seed)
      })
    } else {
      import('@/browser/seed').then((seedImport) => {
        Seed = seedImport.default as typeof SeedBrowser
        resolve(Seed)
      })
    }
  })
}

export const initSeedConstructorSync = () => {
  return SeedSync
}
