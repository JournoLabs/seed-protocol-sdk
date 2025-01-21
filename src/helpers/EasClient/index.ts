import { isBrowser } from '../environment'
import { BaseEasClient } from './BaseEasClient'

let EasClient: typeof BaseEasClient | undefined

export const initEasClient = async () => {
  if (isBrowser()) {
    EasClient = (await import('../../browser/helpers/EasClient')).EasClient
  }

  if (!isBrowser()) {
    EasClient = (await import('../../node/helpers/EasClient')).EasClient
  }
}

export { EasClient }
