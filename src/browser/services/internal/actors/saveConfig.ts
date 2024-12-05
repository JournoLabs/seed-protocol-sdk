import { EventObject, fromCallback } from 'xstate'
import { INTERNAL_SAVING_CONFIG_SUCCESS } from '@/browser/services/internal/constants'
import { getAppDb } from '@/browser/db/sqlWasmClient'
import { sql } from 'drizzle-orm'
import debug from 'debug'
import { FromCallbackInput, InternalMachineContext } from '@/types'
import { appState } from '@/shared/seedSchema'

const logger = debug('app:services:internal:actors:saveConfig')

export const saveConfig = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  if (typeof window === 'undefined') {
    console.error('seedInitBrowser called from non-browser context')
    sendBack({
      type: 'error',
      error: 'Browser method called from non-browser context',
    })
  }

  const { endpoints, addresses } = context

  if (!endpoints) {
    throw new Error('saveConfig called with invalid endpoints')
  }

  const _saveConfig = async (): Promise<void> => {
    // logger('[sdk] [internal/actors] starting _saveConfig')
    const appDb = getAppDb()
    if (!appDb) {
      throw new Error('App DB not found')
    }
    const endpointsValueString = JSON.stringify(endpoints)
    const addressesValueString = JSON.stringify(addresses)
    // TODO: Figure out how to define on conflict with multiple rows added
    try {
      // logger('[sdk] [internal/actors] Saving endpoints to db')
      await appDb
        .insert(appState)
        .values({
          key: 'endpoints',
          value: endpointsValueString,
        })
        .onConflictDoUpdate({
          target: appState.key,
          set: {
            value: endpointsValueString,
          },
          setWhere: sql`key = 'endpoints'`,
        })
      // logger('[sdk] [internal/actors] Saving addresses to db')
      await appDb
        .insert(appState)
        .values({
          key: 'addresses',
          value: addressesValueString,
        })
        .onConflictDoUpdate({
          target: appState.key,
          set: {
            value: addressesValueString,
          },
          setWhere: sql`key = 'addresses'`,
        })
      logger('[sdk] [internal/actors] Should be done saving')
    } catch (error) {
      console.error('Error saving config:', error)
    }
  }

  _saveConfig().then(() => {
    logger('[sdk] [internal/actors] Successfully saved config')
    return sendBack({ type: INTERNAL_SAVING_CONFIG_SUCCESS })
  })

  return () => {}
})
