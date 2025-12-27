import { ClientManagerContext, FromCallbackInput } from "@/types/machines"
import { EventObject, fromCallback } from "xstate"
import { ClientManagerEvents } from "@/services/internal/constants"
import { BaseDb } from "@/db/Db/BaseDb"
import { DbConfig } from "@/types"
import debug from "debug"

const logger = debug('seedSdk:client:actors:dbInit')

export const dbInit = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext>
>(({sendBack, input: {context}}) => {
  logger('dbInit')

  const _dbInit = async () => {
    const { filesDir, dbConfig } = context
    if (!filesDir) {
      throw new Error('filesDir is required')
    }
    // dbConfig is optional - if not provided, defaults will be used
    await BaseDb.prepareDb(filesDir, dbConfig)
  }

  _dbInit().then(() => {
    logger('dbInit success')
    sendBack({ type: ClientManagerEvents.DB_READY })
  })

})