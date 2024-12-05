import { ModelClassType } from '@/types'

const modelStore = new Map<string, ModelClassType>()

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
  modelStore.set(modelName, model)
}
