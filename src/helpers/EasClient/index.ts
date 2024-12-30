import { BaseEasClient } from './BaseEasClient'

let EasClient: typeof BaseEasClient | undefined

export const initEasClient = async () => {
  if (typeof window !== 'undefined') {
    EasClient = (await import('../../browser/helpers/EasClient')).EasClient
  } else {
    EasClient = (await import('../../node/helpers/EasClient')).EasClient
  }
}

export { EasClient }
