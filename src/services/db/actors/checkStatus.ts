import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput } from '@/types'
import {
  BROWSER_FS_TOP_DIR,
  DB_CHECK_STATUS_EXISTS,
  DB_CHECK_STATUS_UPDATE_PATHS,
  DB_CHECK_STATUS_DOES_NOT_EXIST,
} from '@/services/internal/constants'
import debug from 'debug'
import { isBrowser } from '@/helpers/environment'
import { BaseFileManager } from '@/helpers'

const logger = debug('seedSdk:services:db:actors:checkStatus')

export const checkStatus = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context, event, } }) => {
  const { dbName, } = context
  let { pathToDir, } = context


  logger('[db/actors] checkStatus context', context)
  if (isBrowser()) {
    pathToDir = BROWSER_FS_TOP_DIR
  }
  const pathToDbDir = `${pathToDir}/db`
  const pathToDb = `${pathToDbDir}/${dbName}.sqlite3`

  sendBack({
    type: DB_CHECK_STATUS_UPDATE_PATHS,
    pathToDb,
    pathToDir,
    pathToDbDir,
  })

  const _checkStatus = async (): Promise<void> => {
    logger('[db/actors] _checkStatus pathToDb', pathToDb)
    const exists = await BaseFileManager.pathExists(pathToDb)
    if (exists) {
      sendBack({
        type: DB_CHECK_STATUS_EXISTS,
      })
      return
    }
    
    sendBack({ type: DB_CHECK_STATUS_DOES_NOT_EXIST })
  }

  _checkStatus().then(() => {
    return
  })
})
