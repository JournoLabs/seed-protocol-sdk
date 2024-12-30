import { ImageSrc, Json, List, Relation, Text } from '@/browser'
import { SeedInitBrowser } from './browser'
import { ModelClassType } from './model'
import { PropertyType } from './property'

export * from './db'
export * from './model'
export * from './item'
export * from './property'
export * from './browser'
export * from './machines'
export * from './seedProtocol'

export type Endpoints = {
  filePaths: string
  files: string
}

export interface WebpackConfigContext {
  dir: string
  dev: boolean
  isServer: boolean
  buildId: string
  config: any
  defaultLoaders: {
    babel: any
  }
  totalPages: number
  webpack: any
  nextRuntime?: 'nodejs' | 'edge'
}

export interface Seed {
  withSeed: (
    config: any,
    webpack: WebpackConfigContext,
    isServer: boolean,
  ) => void
  seedInitBrowser: () => void
  Model: ModelClassType
  Property: PropertyType
  Relation: typeof Relation
  ImageSrc: typeof ImageSrc
  Text: typeof Text
  Number: typeof Number
  List: typeof List
  Json: typeof Json
  subscribe: (callback: ClientCallback) => void
}

export type Environment = 'browser' | 'node' | 'react-native'

export interface SeedConstructorSync {
  (
    /**
     * Initialization options.
     */
    options?: SeedConstructorOptions,
  ): Partial<Seed>
}

export interface SeedConstructor {
  (
    /**
     * Initialization options.
     */
    options?: SeedConstructorOptions,
  ): Promise<SeedInitBrowser | Partial<Seed>>
}

export interface SeedConfig {
  readonly endpoints: Endpoints
  models: Record<string, ModelClassType>
  arweaveDomain?: string
}

export interface SeedConstructorOptions {
  config: SeedConfig
  readonly addresses: string[]
}

export type ClientCallback = (event: any) => void
