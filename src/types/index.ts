
import { ModelClassType } from './model'
import { PropertyType } from './property'

export * from './db'
export * from './model'
export * from './item'
export * from './property'
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


export type Environment = 'browser' | 'node' | 'react-native'


export interface SeedConfig {
  readonly endpoints: Endpoints
  models: Record<string, ModelClassType>
  arweaveDomain?: string
  filesDir?: string
}

export interface SeedConstructorOptions {
  config: SeedConfig
  readonly addresses: string[]
}

export type ClientCallback = (event: any) => void
