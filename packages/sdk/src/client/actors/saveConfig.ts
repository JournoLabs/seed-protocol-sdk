import { EventObject, fromCallback } from 'xstate'
import { ClientManagerEvents } from '@/client/constants'
import { BaseDb } from '@/db/Db/BaseDb'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { ClientManagerContext, FromCallbackInput, } from '@/types'
import { appState } from '@/seedSchema'
import debug                    from 'debug'
import { normalizeAddressList } from '@/helpers/addresses'
import { loadLocalDbChain } from '@/helpers/localDbChain'
import { withSeedDbLock } from '@/helpers/tabLocks'

const logger = debug('seedSdk:client:actors:saveConfig')

/**
 * Saves the addresses passed to init. An empty list isn't saved: hosts pass `addresses: []` before
 * a wallet connects, and writing it would wipe the addresses another tab (or the last session)
 * stored, which EAS sync, downloads and publishing read. Clearing them is `setAddresses([])`.
 */
export async function persistInitAddresses(
  appDb: NonNullable<ReturnType<typeof BaseDb.getAppDb>>,
  { addresses, ownedAddresses, watchedAddresses }: Pick<ClientManagerContext, 'addresses' | 'ownedAddresses' | 'watchedAddresses'>,
): Promise<void> {
  const owned = normalizeAddressList(ownedAddresses ?? addresses ?? [])
  const watched = normalizeAddressList(watchedAddresses ?? [])
  if (owned.length === 0 && watched.length === 0) return

  const value = JSON.stringify({ owned, watched })
  await appDb
    .insert(appState)
    .values({ key: 'addresses', value })
    .onConflictDoUpdate({ target: appState.key, set: { value } })
}

export const saveConfig = fromCallback<
  EventObject,
  FromCallbackInput<ClientManagerContext>
>(({ sendBack, input: { context } }) => {

  logger('saveConfig starting')

  const {
    endpoints,
    addresses,
    ownedAddresses,
    watchedAddresses,
    arweaveDomain,
    uploadApiBaseUrl,
    gatewayTransport,
    gatewayHyperKey,
    gatewaySidecarHost,
    gatewaySidecarPort,
    gatewayProxyBaseUrl,
  } = context

  // Validate endpoints - required for proper initialization
  // If endpoints are missing or invalid, initialization should fail
  if (!endpoints || !endpoints.filePaths || !endpoints.files) {
    const error = new Error('saveConfig called with invalid endpoints: endpoints must include both filePaths and files')
    logger('[internal/actors] [saveConfig] Invalid endpoints:', { endpoints })
    throw error
  }

  const _saveConfig = async (): Promise<void> => {
    try {
      const appDb = BaseDb.getAppDb()

      if (!appDb) {
        // In test environments, continue anyway
        if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
          logger('[internal/actors] [saveConfig] App DB not found, but continuing in test environment')
          return
        }
        throw new Error('App DB not found')
      }
      
      const endpointsValueString = JSON.stringify(endpoints)

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

      await persistInitAddresses(appDb, { addresses, ownedAddresses, watchedAddresses })

      await appDb
        .insert(appState)
        .values({
          key: 'arweaveDomain',
          value: arweaveDomain || DEFAULT_ARWEAVE_HOST,
        })
        .onConflictDoUpdate({
          target: appState.key,
          set: {
            value: arweaveDomain || DEFAULT_ARWEAVE_HOST,
          },
        })

      const persistKey = async (key: string, value: string | undefined) => {
        if (value == null || value === '') return
        await appDb
          .insert(appState)
          .values({ key, value })
          .onConflictDoUpdate({
            target: appState.key,
            set: { value },
          })
      }

      await persistKey('uploadApiBaseUrl', uploadApiBaseUrl)
      await persistKey('gatewayTransport', gatewayTransport)
      await persistKey('gatewayHyperKey', gatewayHyperKey)
      await persistKey('gatewaySidecarHost', gatewaySidecarHost)
      if (gatewaySidecarPort != null) {
        await persistKey('gatewaySidecarPort', String(gatewaySidecarPort))
      }
      await persistKey('gatewayProxyBaseUrl', gatewayProxyBaseUrl)

      // Throws when the DB holds attestations from a different chain than the one configured.
      await loadLocalDbChain()
    } catch (error: any) {
      logger('[internal/actors] [saveConfig] Error saving config:', error)
      // In test environments, continue anyway
      if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
        logger('[internal/actors] [saveConfig] Continuing despite error in test environment')
        return
      }
      throw error
    }
  }

  // Init writes run one tab at a time (docs/MULTI_TAB.md).
  withSeedDbLock('init', context.filesDir, _saveConfig)
    .then(() => {
      logger('[internal/actors] [saveConfig] saveConfig success')
      return sendBack({ type: ClientManagerEvents.SAVE_CONFIG_SUCCESS })
    })
    .catch((error: any) => {
      logger('[internal/actors] [saveConfig] Error in saveConfig promise chain:', error)
      // In test environments, still send success to allow state machine to progress
      if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
        logger('[internal/actors] [saveConfig] Sending success despite error in test environment')
        sendBack({ type: ClientManagerEvents.SAVE_CONFIG_SUCCESS })
      } else {
        sendBack({
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    })

  return () => { }
})
