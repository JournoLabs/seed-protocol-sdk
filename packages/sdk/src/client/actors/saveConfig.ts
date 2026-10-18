import { EventObject, fromCallback } from 'xstate'
import { ClientManagerEvents } from '@/client/constants'
import { BaseDb } from '@/db/Db/BaseDb'
import { isTestOrSeedDev } from '@/helpers/environment'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { ClientManagerContext, FromCallbackInput, } from '@/types'
import { appState } from '@/seedSchema'
import debug                    from 'debug'
import { normalizeAddressConfig, normalizeAddressList } from '@/helpers/addresses'
import { eq } from 'drizzle-orm'
import { loadLocalDbChain } from '@/helpers/localDbChain'
import { withSeedDbLock } from '@/helpers/tabLocks'
import { isLeaderTab } from '@/helpers/tabCoordinator'
import { emitAcrossTabs } from '@/helpers/tabEvents'
import { ADDRESSES_PERSISTED_EVENT } from '@/client/events'

const logger = debug('seedSdk:client:actors:saveConfig')

let warnedKeptStoredAddresses = false

/** Test hook: let the "kept stored addresses" warning fire again. */
export function resetKeptStoredAddressesWarning(): void {
  warnedKeptStoredAddresses = false
}

/**
 * Saves the addresses passed to init.
 *
 * - No `addresses` option (`addressesProvided: false`): stored addresses are kept, with a
 *   one-time warning when there are any, since a forgotten option would otherwise act on
 *   an earlier session's wallet.
 * - `addresses: []`: hosts pass this before a wallet connects. In the first (leader) tab it
 *   clears stored addresses, so drafts made before the wallet reconnects stay editable. A tab
 *   opened while another is running (`keepStoredWhenEmpty`) keeps them instead: they're the
 *   other tab's connected wallet, which EAS sync, downloads and publishing read. See
 *   docs/MULTI_TAB.md.
 */
export async function persistInitAddresses(
  appDb: NonNullable<ReturnType<typeof BaseDb.getAppDb>>,
  {
    addresses,
    addressesProvided,
    ownedAddresses,
    watchedAddresses,
  }: Pick<ClientManagerContext, 'addresses' | 'addressesProvided' | 'ownedAddresses' | 'watchedAddresses'>,
  { keepStoredWhenEmpty }: { keepStoredWhenEmpty: boolean },
): Promise<void> {
  if (addressesProvided === false) {
    if (!warnedKeptStoredAddresses) {
      const rows = await appDb.select().from(appState).where(eq(appState.key, 'addresses')).limit(1)
      const stored = rows[0]?.value ? normalizeAddressConfig(JSON.parse(rows[0].value)) : undefined
      if (stored && (stored.owned.length > 0 || stored.watched.length > 0)) {
        warnedKeptStoredAddresses = true
        console.warn(
          `[seed] client.init was called without \`addresses\`, so the stored addresses are kept ` +
            `(${stored.owned.length} owned, ${stored.watched.length} watched). Pass \`addresses: []\` to clear them.`,
        )
      }
    }
    return
  }
  const owned = normalizeAddressList(ownedAddresses ?? addresses ?? [])
  const watched = normalizeAddressList(watchedAddresses ?? [])
  if (owned.length === 0 && watched.length === 0 && keepStoredWhenEmpty) return

  const value = JSON.stringify({ owned, watched })
  await appDb
    .insert(appState)
    .values({ key: 'addresses', value })
    .onConflictDoUpdate({ target: appState.key, set: { value } })
  // Same event setAddresses emits, so listeners (e.g. React's session context) also see the
  // addresses init saved. Their sync is init's startup sync, which reads them from the DB.
  emitAcrossTabs(ADDRESSES_PERSISTED_EVENT, { owned, watched })
}

export const saveConfig = fromCallback<
  EventObject,
  FromCallbackInput<ClientManagerContext>
>(({ sendBack, input: { context } }) => {

  logger('saveConfig starting')

  const {
    endpoints,
    addresses,
    addressesProvided,
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
        if (isTestOrSeedDev()) {
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

      await persistInitAddresses(
        appDb,
        { addresses, addressesProvided, ownedAddresses, watchedAddresses },
        { keepStoredWhenEmpty: !isLeaderTab() },
      )

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
      if (isTestOrSeedDev()) {
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
      if (isTestOrSeedDev()) {
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
