import { FromCallbackInput } from "@/types";
import { fromCallback } from "xstate";
import { ClientManagerContext } from "@/types";
import { EventObject } from "xstate";
import debug from "debug";
import { appState } from "@/seedSchema";

const logger = debug('app:client:writeToDb')

export const saveAppState = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext>
>(
  ({sendBack, input: {key, value}}) => {

    const _saveAppState = async () => {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      if (!BaseDb) {
        throw new Error('BaseDb not found')
      }
      const appDb = BaseDb.getAppDb()
      if (!appDb) {
        throw new Error('App DB not found')
      }

      console.log(`key: ${key} value: ${value}`)

      appDb.insert(appState)
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
      
    }

    _saveAppState().then(() => {
      sendBack({
        type: 'saveAppStateSuccess',
        key,
        value,
      })
    })
    
  })
