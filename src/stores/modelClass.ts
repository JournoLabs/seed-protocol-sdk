import { ModelClassType } from '@/types'
import debug from 'debug'

const logger = debug('seedSdk:stores:modelClass')

// Use a global symbol to ensure the store is shared across all module instances
// This prevents issues when the SDK is bundled and imported by external projects
const MODEL_STORE_SYMBOL = Symbol.for('@seedprotocol/sdk:modelStore')

// Get the global object (works in both Node.js and browser)
const getGlobal = (): any => {
  if (typeof globalThis !== 'undefined') {
    return globalThis
  }
  if (typeof window !== 'undefined') {
    return window
  }
  if (typeof global !== 'undefined') {
    return global
  }
  throw new Error('Unable to locate global object')
}

// Get or create the shared model store
const getModelStore = (): Map<string, ModelClassType> => {
  const globalObj = getGlobal()
  if (!globalObj[MODEL_STORE_SYMBOL]) {
    globalObj[MODEL_STORE_SYMBOL] = new Map<string, ModelClassType>()
  }
  return globalObj[MODEL_STORE_SYMBOL]
}

const modelStore = getModelStore()


export const getModels = (): Record<string, ModelClassType> => {
  return Object.fromEntries(modelStore)
}

export const getModel = (modelName: string): ModelClassType | undefined => {
  return modelStore.get(modelName)
}

export const getModelNames = (): string[] => {
  return Array.from(modelStore.keys())
}

export const setModel = (modelName: string, model: ModelClassType) => {
  logger('setModel:', modelName)
  modelStore.set(modelName, model)
}
