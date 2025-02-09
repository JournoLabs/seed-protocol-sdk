import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput } from '@/types'
import {
  BROWSER_FS_TOP_DIR,
  DB_CHECK_STATUS_EXISTS,
  DB_CHECK_STATUS_UPDATE_PATHS,
} from '@/services/internal/constants'
import debug from 'debug'
import { isBrowser } from '@/helpers/environment'

const logger = debug('app:services:db:actors:checkStatus')

export const checkStatus = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context, event, } }) => {
  const { dbName, } = context
  let { pathToDir, } = context


  logger('[db/actors] checkStatus context', context)
  console.log('[db/actors] checkStatus context', context)
  console.log('[db/actors] checkStatus event', event)
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
    // logger('[db/actors] _checkStatus pathToDb', pathToDb)
    // const exists = await fs.promises.exists(pathToJournal)
    // if (exists) {
    //   sendBack({
    //     type: DB_CHECK_STATUS_EXISTS,
    //   })
    //   return
    // }
    //
    // return new Promise((resolve) => {
    //   sendBack({ type: DB_CHECK_STATUS_DOES_NOT_EXIST })
    //
    // })
  }

  _checkStatus().then(() => {
    sendBack({ type: DB_CHECK_STATUS_EXISTS })
    return
  })
})
