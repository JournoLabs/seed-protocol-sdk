import { EventObject, fromCallback } from 'xstate'
import { areFsListenersReady, isFsInitialized } from '@/browser/events/files'
import { waitForEvent } from '@/browser/events'
import {
  BROWSER_FS_TOP_DIR,
  DB_WAITING_FOR_FILES_RECEIVED,
  INTERNAL_CONFIGURING_FS_SUCCESS,
} from '@/browser/services/internal/constants'
import { fs } from '@zenfs/core'
import debug from 'debug'
import { FromCallbackInput, InternalMachineContext } from '@/types'

const logger = debug('app:internal:actors:configureFs')

export const configureFs = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  const { endpoints, appDbService } = context

  logger('[internal/actors] [configureFs] Configuring FS')

  const _configureFs = async (): Promise<void> => {
    logger('[internal/actors] [configureFs] calling _configureFs')

    logger(
      '[internal/actors] [configureFs] areFsListenersReady:',
      areFsListenersReady(),
    )
    logger(
      '[internal/actors] [configureFs] isFsInitialized:',
      isFsInitialized(),
    )

    await waitForEvent({
      req: {
        eventLabel: 'fs.downloadAll.request',
        data: { endpoints },
      },
      res: {
        eventLabel: 'fs.downloadAll.success',
      },
    })

    const journalPath = `${BROWSER_FS_TOP_DIR}/db/meta/_journal.json`

    const journalExists = await fs.promises.exists(journalPath)

    if (journalExists) {
      appDbService.send({ type: DB_WAITING_FOR_FILES_RECEIVED })
    }

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

    logger('[internal/actors] [configureFs] fs configured!')
  }

  // Some of our dependencies use fs sync functions, which don't work with
  // OPFS. ZenFS creates an async cache of all files so that the sync functions
  // work, but we have to wait for it to be built. Otherwise things like
  // drizzleMigrate will fail since they can't see the migration files yet.
  _configureFs().then(() => {
    sendBack({ type: INTERNAL_CONFIGURING_FS_SUCCESS })
    return
  })

  return () => {}
})
