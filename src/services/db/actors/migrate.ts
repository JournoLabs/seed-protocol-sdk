import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput, SqliteWasmResult } from '@/types'
import {
  BROWSER_FS_TOP_DIR,
  DB_MIGRATING_SUCCESS,
} from '@/services/internal/constants'
import debug from 'debug'
import { waitForFile } from '@/helpers/files'
import { BaseDb } from '@/db/Db/BaseDb'
import fs from '@zenfs/core'

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


    if (!journalExists) {
      await waitForFile(journalPath)
    }
  }

  const _migrate = async (): Promise<void> => {
    await BaseDb.migrate(pathToDbDir, dbName, dbId)
  }

  _checkForFiles()
    .then(() => {
      if (journalExists) {
        return _migrate()
      }
    })
    .then(() => {
      sendBack({ type: DB_MIGRATING_SUCCESS, dbName })
    })

  return () => { }
})
