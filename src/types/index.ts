
import type { Model } from '@/Model/Model'
import { ModelClassType } from './model'

export * from './db'
export * from './model'
export * from './item'
export * from './property'
export * from './machines'
export * from './seedProtocol'
export * from './browser'
export * from './arweave'

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


export interface DbConfig {
  dbUrl?: string
  schemaDir?: string
  outDir?: string
}

export interface SeedConfig {
  readonly endpoints: Endpoints
  models?: Record<string, Model>
  arweaveDomain?: string
  filesDir?: string
  dbConfig?: DbConfig
}

export interface SeedConstructorOptions {
  config: SeedConfig
  readonly addresses?: string[]
}

export type ClientCallback = (event: any) => void
