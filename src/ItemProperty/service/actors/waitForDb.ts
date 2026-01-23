import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, PropertyMachineContext } from '@/types'
import { BaseDb } from '@/db/Db/BaseDb'
import debug from 'debug'

const logger = debug('seedSdk:ItemProperty:service:actors:waitForDb')

export const waitForDb = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext>
>(({ sendBack }) => {
  // Check immediately first
  const appDb = BaseDb.getAppDb()
  if (appDb) {
    logger('Database is ready (immediate check)')
    sendBack({ type: 'waitForDbSuccess' })
    return
  }

  // If not ready, poll with timeout
  const _waitForDb = new Promise<void>((resolve, reject) => {
    const startTime = Date.now()
    const timeout = 10000 // 10 second timeout
    const interval = setInterval(() => {
      const appDb = BaseDb.getAppDb()
      if (appDb) {
        clearInterval(interval)
        logger('Database is ready (after polling)')
        resolve()
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval)
        const error = new Error('Database not available after timeout')
        logger(`Database wait timeout: ${error.message}`)
        reject(error)
      }
    }, 100)
  })

  _waitForDb
    .then(() => {
      logger('Sending waitForDbSuccess event')
      sendBack({ type: 'waitForDbSuccess' })
    })
    .catch((error) => {
      logger(`Error waiting for database: ${error}`)
      sendBack({ type: 'waitForDbError', error: error.message })
    })
})
