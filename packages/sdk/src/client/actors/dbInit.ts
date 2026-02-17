import { ClientManagerContext, FromCallbackInput } from "@/types/machines"
import { EventObject, fromCallback } from "xstate"
import { ClientManagerEvents } from "@/client/constants"
import { BaseDb } from "@/db/Db/BaseDb"
import debug from "debug"

const logger = debug('seedSdk:client:actors:dbInit')

export const dbInit = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext>
>(({sendBack, input: {context}}) => {

  const _dbInit = async () => {
    const { filesDir } = context
    if (!filesDir) {
      throw new Error('filesDir is required')
    }
    
    // Prepare databases - this handles all initialization, migration, and file setup
    await BaseDb.prepareDb(filesDir)

    
    // Verify database is ready
    const appDb = BaseDb.getAppDb()
    if (!appDb) {
      throw new Error('Database not available after preparation')
    }
    
    logger('[client/actors] [dbInit] Database prepared and ready')
  }

  _dbInit()
    .then(() => {
      sendBack({ type: ClientManagerEvents.DB_READY })
    })
    .catch((error) => {
      logger('Error in dbInit:', error)
      sendBack({ 
        type: 'ERROR', 
        error: error instanceof Error ? error : new Error(String(error))
      })
    })

})