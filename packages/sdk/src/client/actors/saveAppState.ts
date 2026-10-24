import { fromCallback } from "xstate";
import { EventObject } from "xstate";
import debug from "debug";
import { appState } from "@/seedSchema";
import { BaseDb } from '@/db/Db/BaseDb'

const logger = debug('seedSdk:client:writeToDb')

type SaveAppStateInput = {
  key: string
  value: any
}

export const saveAppState = fromCallback<
EventObject, 
SaveAppStateInput
>(
  ({sendBack, input: {key, value}}) => {

    const _saveAppState = async () => {
      try {
        const appDb = BaseDb.getAppDb()
        if (!appDb) {
          throw new Error('App DB not found')
        }

        const result = await appDb.insert(appState)
          .values({
            key: key,
            value: JSON.stringify(value),
          })
          .onConflictDoUpdate({
            target: appState.key,
            set: {
              value: JSON.stringify(value),
            },
          })

        logger('result', result)
      } catch (error: any) {
        logger('[client/actors] [saveAppState] Error saving app state:', error)
        throw error
      }
    }

    _saveAppState()
      .then(() => {
        sendBack({
          type: 'saveAppStateSuccess',
          key,
          value,
        })
      })
      .catch((error: any) => {
        logger('[client/actors] [saveAppState] Error in promise chain:', error)
        sendBack({
          type: 'saveAppStateError',
          error: error instanceof Error ? error : new Error(String(error)),
          key,
          value,
        })
      })
    
  })
