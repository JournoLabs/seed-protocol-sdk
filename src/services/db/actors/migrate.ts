import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput, SqliteWasmResult } from '@/types'
import {
  BROWSER_FS_TOP_DIR,
  DB_MIGRATING_SUCCESS,
} from '@/services/internal/constants'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import fs from '@zenfs/core'
import { FileManager } from '@/browser/helpers/FileManager'
import { isBrowser } from '@/helpers/environment'

const logger = debug('app:services:db:actors:migrate')



export const migrate = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {
  const { pathToDbDir, dbId, dbName } = context

  logger('[db/actors] migrate context', context)

  let journalExists = false


  const _checkForFiles = async (): Promise<void> => {
    const journalPath = `/${pathToDbDir}/meta/_journal.json`

    journalExists = await fs.promises.exists(journalPath)

    if (!journalExists && isBrowser()) {
      await FileManager.waitForFile(journalPath, 500, 60000)
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
      console.log('sending db migrating success')
      sendBack({ type: DB_MIGRATING_SUCCESS, dbName })
    })

  return () => { }
})
