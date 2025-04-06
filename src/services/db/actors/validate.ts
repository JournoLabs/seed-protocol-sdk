import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput } from '@/types/machines'
import {
  DB_VALIDATING_SUCCESS,
  DB_VALIDATING_WAIT,
} from '@/services/internal/constants'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

export const validate = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {
  const { pathToDir, pathToDb } = context

  const pathsToCheck = [
    pathToDir,
    `${pathToDir}/db`,
    `${pathToDir}/db/meta`,
    `${pathToDir}/db/meta/_journal.json`,
  ]

  const _validate = async (): Promise<boolean> => {
    // If any of the necessary files don't exist, we wipe them all and recreate
    let exists = false

    for (const path of pathsToCheck) {
      if (!path) {
        continue
      }
      exists = await BaseFileManager.pathExists(path)
      if (!exists) {
        sendBack({
          type: DB_VALIDATING_WAIT,
        })
        return false
      }
    }
    return exists
  }

  _validate().then((allFilesExist) => {
    if (allFilesExist) {
      sendBack({ type: DB_VALIDATING_SUCCESS, pathToDb, pathToDir })
      return
    }
    sendBack({ type: DB_VALIDATING_WAIT })
  })
})
