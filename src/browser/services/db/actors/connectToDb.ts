import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput } from '@/types'
import { getSqliteWasmClient } from '@/browser/db/sqlWasmClient'
import { DB_CREATING_SUCCESS } from '@/browser/services/internal/constants'
import debug from 'debug'

const logger = debug('app:services:db:actors:connectToDb')

export const connectToDb = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {
  logger('[db/actors] connectToDb context', context)

  const { dbName, pathToDir } = context

  let isConnecting = false
  let dbId: string | undefined

  const _create = async (): Promise<void> => {
    if (isConnecting) {
      return
    }
    isConnecting = true
    let response

    const sqliteWasmClient = await getSqliteWasmClient()

    //@ts-ignore
    response = await sqliteWasmClient('config-get', {})
    logger(response)
    logger('Running SQLite3 version', response.result.version.libVersion)

    //@ts-ignore
    response = await sqliteWasmClient('open', {
      filename: `file:${pathToDir}/db/${dbName}.sqlite3?vfs=opfs`,
    })

    logger(response)
    dbId = response.dbId
    // logger(`dbId: ${dbId}`)
    logger(
      'OPFS is available, created persisted database at',
      response.result.filename.replace(/^file:(.*?)\?vfs=opfs$/, '$1'),
    )
  }

  const interval = setInterval(() => {
    // TODO: Add a timeout
    // TODO: Add a cancel token to the promise so we can prevent more loops starting while we're checking the successful outcome
    if (dbId) {
      // logger(
      //   '[db/actors] opening sqliteWasm connection with dbId:',
      //   dbId,
      // )
      clearInterval(interval)
      sendBack({ type: DB_CREATING_SUCCESS, dbId })
      return
    }
    _create()
      .then(() => {
        return
      })
      .catch((e) => {
        isConnecting = false
      })
  }, 500)

  return () => {
    if (interval) {
      clearInterval(interval)
    }
  }
})
