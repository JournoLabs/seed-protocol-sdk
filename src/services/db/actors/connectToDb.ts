import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput } from '@/types'
import { DB_CREATING_SUCCESS } from '@/services/internal/constants'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'

const logger = debug('seedSdk:services:db:actors:connectToDb')

export const connectToDb = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {
  logger('[db/actors] connectToDb context', context)

  const { dbName, pathToDir } = context

  if (!pathToDir || !dbName) {
    throw new Error('pathToDir and dbName are required')
  }

  let isConnecting = false

  const _connectToDb = async (): Promise<void> => {
    if (isConnecting) {
      return
    }
    isConnecting = true


    const dbId = await BaseDb.connectToDb(pathToDir,)
    if (dbId) {
      sendBack({ type: DB_CREATING_SUCCESS, dbId, })
    }
    isConnecting = false
  }

  _connectToDb().then(() => {
    return
  })

})
