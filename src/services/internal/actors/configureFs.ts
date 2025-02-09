import { EventObject, fromCallback } from 'xstate'
import { areFsListenersReady, isFsInitialized } from '@/events/files'
import { waitForEvent } from '@/events'
import {
  BROWSER_FS_TOP_DIR,
  DB_WAITING_FOR_FILES_RECEIVED,
  INTERNAL_CONFIGURING_FS_SUCCESS,
} from '@/services/internal/constants'
import fs from '@zenfs/core'
import debug from 'debug'
import { FromCallbackInput, InternalMachineContext } from '@/types'
import { isBrowser } from '@/helpers/environment'

const logger = debug('app:internal:actors:configureFs')

export const configureFs = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  const { endpoints, appDbService, filesDir, } = context

  logger('[internal/actors] [configureFs] Configuring FS')

  const _configureFs = async (): Promise<boolean> => {
    logger('[internal/actors] [configureFs] calling _configureFs')

    logger(
      '[internal/actors] [configureFs] areFsListenersReady:',
      areFsListenersReady(),
    )
    logger(
      '[internal/actors] [configureFs] isFsInitialized:',
      isFsInitialized(),
    )

    if (isBrowser()) {
      await waitForEvent({
        req: {
          eventLabel: 'fs.downloadAll.request',
          data: { endpoints },
        },
        res: {
          eventLabel: 'fs.downloadAll.success',
        },
      })
    }


    const journalPath = `${filesDir || BROWSER_FS_TOP_DIR}/db/meta/_journal.json`


    let journalExists = await fs.promises.exists(journalPath)

    if (!journalExists) {
      journalExists = fs.existsSync(journalPath)
    }

    if (journalExists) {
      appDbService.send({ type: DB_WAITING_FOR_FILES_RECEIVED })
      logger('[internal/actors] [configureFs] fs configured!')
      return true
    }

    sendBack({ type: 'shouldWaitForFiles' })
    

    return false

    // return new Promise<void>((resolve) => {
    //   const interval = setInterval(() => {
    //     journalExistsSync = fs.existsSync(journalPath)
    //     logger(
    //       '[internal/actors] [configureFs] journalExistsSync:',
    //       journalExistsSync,
    //     )
    //     if (journalExistsSync) {
    //       service.send({ type: DB_WAITING_FOR_FILES_RECEIVED })
    //       clearInterval(interval)
    //       resolve()
    //     }
    //   }, 200)
    // })

  }

  // Some of our dependencies use fs sync functions, which don't work with
  // OPFS. ZenFS creates an async cache of all files so that the sync functions
  // work, but we have to wait for it to be built. Otherwise things like
  // drizzleMigrate will fail since they can't see the migration files yet.
  _configureFs().then((fsConfigured) => {
    if (fsConfigured) {
      sendBack({ type: INTERNAL_CONFIGURING_FS_SUCCESS })
    }
    return
  })

  return () => { }
})
