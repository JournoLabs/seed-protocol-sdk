import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput, SqliteWasmResult } from '@/types'
import {
  BROWSER_FS_TOP_DIR,
  DB_MIGRATING_SUCCESS,
} from '@/services/internal/constants'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { isBrowser } from '@/helpers/environment'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

const logger = debug('seedSdk:services:db:actors:migrate')



export const migrate = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {
  const { pathToDbDir, dbId, dbName } = context

  logger('[db/actors] migrate context', context)

  let journalExists = false


  const _checkForFiles = async (): Promise<void> => {
    const journalPath = `/${pathToDbDir}/meta/_journal.json`

    journalExists = await BaseFileManager.pathExists(journalPath)

    if (!journalExists && isBrowser()) {
      await BaseFileManager.waitForFile(journalPath,)
    }
  }

  const _migrate = async (): Promise<void> => {
    await BaseDb.migrate(pathToDbDir, dbName, dbId)
  }

  _checkForFiles()
    .then(() => {
      if (!isBrowser()) {
        return _migrate()
      }
      if (journalExists) {
        return _migrate()
      }
    })
    .then(() => {
      logger('sending db migrating success')
      sendBack({ type: DB_MIGRATING_SUCCESS, dbName })
    })

  return () => { }
})
