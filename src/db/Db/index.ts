import { isBrowser } from '@/helpers/environment'
import { BaseDb } from './BaseDb'

let Db: typeof BaseDb | undefined

export const initDb = async () => {
  if (isBrowser()) {
    Db = (await import('../../browser/db/Db')).Db
  }

  if (!isBrowser()) {
    Db = (await import('../../node/db/Db')).Db
  }

  // TODO: Add config for React Native
}

export { Db }
