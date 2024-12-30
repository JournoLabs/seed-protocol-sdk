import { BaseDb } from './BaseDb'

let Db: typeof BaseDb | undefined

export const initDb = async () => {
  if (typeof window !== 'undefined') {
    Db = (await import('../../browser/db/Db')).Db
  } else {
    Db = (await import('../../node/db/Db')).Db
  }
}

export { Db }