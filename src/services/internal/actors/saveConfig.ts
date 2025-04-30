import { EventObject, fromCallback } from 'xstate'
import { INTERNAL_SAVING_CONFIG_SUCCESS } from '@/services/internal/constants'
import { BaseDb } from '@/db/Db/BaseDb'
import { FromCallbackInput, InternalMachineContext } from '@/types'
import { appState } from '@/seedSchema'
import debug                    from 'debug'

const logger = debug('seedSdk:services:internal:actors:saveConfig')

export const saveConfig = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {

  logger('saveConfig starting')

  const { endpoints, addresses, arweaveDomain } = context

  if (!endpoints) {
    throw new Error('saveConfig called with invalid endpoints')
  }

  const _saveConfig = async (): Promise<void> => {
    const appDb = BaseDb.getAppDb()

    if (!appDb) {
      throw new Error('App DB not found')
    }
    const endpointsValueString = JSON.stringify(endpoints)
    const addressesValueString = JSON.stringify(addresses)

    // TODO: Figure out how to define on conflict with multiple rows added
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
      })

    if (addresses) {
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
      })
    }

    await appDb
      .insert(appState)
      .values({
        key: 'arweaveDomain',
        value: arweaveDomain || 'arweave.net',
      })
      .onConflictDoUpdate({
        target: appState.key,
        set: {
          value: arweaveDomain || 'arweave.net',
        },
      })
    }

  _saveConfig().then(() => {
    logger('saveConfig success')
    return sendBack({ type: INTERNAL_SAVING_CONFIG_SUCCESS })
  })

  return () => { }
})
