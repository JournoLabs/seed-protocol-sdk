import React, { FC, useCallback, useEffect, useRef } from "react"
import {
  ConnectButton as ConnectButtonThirdweb,
  darkTheme,
  useActiveAccount,
  useActiveWallet,
  useActiveWalletConnectionStatus,
  useIsAutoConnecting,
} from "thirdweb/react"
import { client as seedClient } from "@seedprotocol/sdk"
import {
  getClient,
  getConnectedManagedAccountAddress,
  getManagedAccountWallet,
  getModularAccountWallet,
  getWalletsForConnectButton,
} from "../helpers/thirdweb"
import { usePublishConfig } from "./PublishProvider"
import { getPublishConfig } from "../config"
import { optimismSepolia } from "thirdweb/chains"
import type { Account, Wallet } from "thirdweb/wallets"
import type { PublishConfig } from "../config"
import { ensureExecutorModuleInstalled } from "../helpers/ensureExecutorModule"
import { PublishManager } from "../services/publishManager"

/** Session flag so we do not force autoConnect after an explicit UI disconnect (survives reload). */
const USER_DISCONNECTED_SESSION_KEY = "seedProtocol:publish:userChoseWalletDisconnect"

function reportWalletSetupWarning(err: unknown) {
  console.error("[ConnectButton] Wallet setup / module install failed:", err)
  getPublishConfig().onWalletSetupWarning?.(err)
}

/** Resolves after `ClientManager.init()` has finished; `setAddresses` requires this. */
function waitUntilSeedInitialized(): Promise<void> {
  if (seedClient.isInitialized()) return Promise.resolve()
  return new Promise((resolve) => {
    seedClient.onReady(() => resolve())
  })
}

/**
 * Executor module (ModularCore) must be installed on the **ManagedAccount** (EIP-4337) contract.
 * The EIP-7702 modular wallet contract does not expose Thirdweb's installModule / Router API;
 * calling it there reverts with "Router: function does not exist."
 */
async function ensureExecutorModulesForConnect(
  modularAccount: Account,
  managedAddress: string | undefined,
  config: PublishConfig,
): Promise<void> {
  if (!config.modularAccountModuleContract) {
    return
  }

  if (config.useModularExecutor) {
    if (!managedAddress) {
      reportWalletSetupWarning(
        new Error(
          'Executor module: managed account address not available yet (managed wallet may still be syncing).',
        ),
      )
      return
    }
    try {
      const mw = getManagedAccountWallet()
      await mw.autoConnect({ client: getClient(), chain: optimismSepolia })
      const ma = mw.getAccount()
      if (!ma) {
        reportWalletSetupWarning(new Error('Executor module: managed wallet has no account'))
        return
      }
      await ensureExecutorModuleInstalled(managedAddress, ma, config)
    } catch (err) {
      reportWalletSetupWarning(err)
    }
    return
  }

  try {
    await ensureExecutorModuleInstalled(modularAccount.address, modularAccount, config)
  } catch (err) {
    reportWalletSetupWarning(err)
  }
}

const ConnectButton: FC = () => {
  const config = usePublishConfig()
  const wallet = useActiveWallet()
  const activeAccount = useActiveAccount()
  const connectionStatus = useActiveWalletConnectionStatus()
  const isAutoConnecting = useIsAutoConnecting()
  /** Avoid duplicate setAddresses when onConnect and the reconcile effect both run. */
  const lastSyncedOwnedKey = useRef<string | null>(null)
  const prevIsAutoConnecting = useRef(false)
  const reloadAutoConnectRetried = useRef(false)

  /**
   * Thirdweb sometimes finishes autoConnect on full reload with `disconnected` and no wallet
   * (see debug: isAutoConnecting true→false then disconnected). One explicit in-app autoConnect
   * retry recovers without affecting users who chose Disconnect (sessionStorage gate).
   */
  useEffect(() => {
    if (typeof window === "undefined") return
    const prev = prevIsAutoConnecting.current
    prevIsAutoConnecting.current = isAutoConnecting

    let navType: string | undefined
    try {
      navType = (
        performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined
      )?.type
    } catch {
      navType = undefined
    }
    if (navType !== "reload") return

    let userChoseDisconnect = false
    try {
      userChoseDisconnect =
        sessionStorage.getItem(USER_DISCONNECTED_SESSION_KEY) === "1"
    } catch {
      userChoseDisconnect = false
    }
    if (userChoseDisconnect) return

    if (!prev || isAutoConnecting || connectionStatus !== "disconnected") return
    if (reloadAutoConnectRetried.current) return
    reloadAutoConnectRetried.current = true

    void getModularAccountWallet()
      .autoConnect({ client: getClient(), chain: optimismSepolia })
      .catch(() => {
        /* no session or iframe not ready; Connect UI can still sign in */
      })
  }, [connectionStatus, isAutoConnecting])

  const syncActiveWalletToSeed = useCallback(
    async (activeWallet: Wallet) => {
      const account = activeWallet.getAccount()
      if (!account) {
        return
      }
      await waitUntilSeedInitialized()
      PublishManager.stopAll()
      const owned = new Set<string>([account.address.toLowerCase()])
      let managedAddress: string | undefined
      if (config.useModularExecutor) {
        const tryManaged = async () => {
          try {
            return await getConnectedManagedAccountAddress(optimismSepolia)
          } catch {
            return undefined
          }
        }
        managedAddress = await tryManaged()
        if (!managedAddress) {
          await new Promise<void>((r) => queueMicrotask(() => r()))
          managedAddress = await tryManaged()
        }
        if (managedAddress) {
          owned.add(managedAddress.toLowerCase())
        }
      }
      const ownedKey = [...owned].sort().join(",")
      if (lastSyncedOwnedKey.current === ownedKey) {
        return
      }
      lastSyncedOwnedKey.current = ownedKey
      try {
        await seedClient.setAddresses({ owned: [...owned] })
      } catch (err) {
        lastSyncedOwnedKey.current = null
        console.warn("[ConnectButton] Failed to set seed client addresses:", err)
        throw err
      }
      await ensureExecutorModulesForConnect(account, managedAddress, config)
    },
    [config],
  )

  /**
   * Thirdweb autoConnect restores the wallet without calling onConnect. Seed addresses live in
   * SQLite (OPFS); after a wipe there is no app_state row until setAddresses runs again.
   */
  useEffect(() => {
    if (isAutoConnecting) {
      return
    }
    if (connectionStatus !== "connected") {
      lastSyncedOwnedKey.current = null
      return
    }
    if (!wallet) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        if (cancelled) return
        await syncActiveWalletToSeed(wallet)
      } catch {
        /* logged in syncActiveWalletToSeed */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    wallet,
    activeAccount?.address,
    connectionStatus,
    isAutoConnecting,
    syncActiveWalletToSeed,
  ])

  const handleDisconnect = () => {
    try {
      sessionStorage.setItem(USER_DISCONNECTED_SESSION_KEY, "1")
    } catch {
      /* private mode / SSR */
    }
    PublishManager.stopAll()
  }

  const handleConnect = async (activeWallet: Wallet, _allConnectedWallets: Wallet[]) => {
    const account = activeWallet.getAccount()
    if (!account) return
    try {
      sessionStorage.removeItem(USER_DISCONNECTED_SESSION_KEY)
    } catch {
      /* ignore */
    }
    console.log('[ConnectButton] Connected', account.address)
    try {
      await syncActiveWalletToSeed(activeWallet)
    } catch {
      /* syncActiveWalletToSeed logs */
    }
  }

  return (
    <ConnectButtonThirdweb
      client={getClient()}
      wallets={getWalletsForConnectButton()}
      autoConnect={true}
      chain={optimismSepolia}
      chains={[ optimismSepolia, ]}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      theme={darkTheme({
        colors: {
          primaryButtonBg: '#1D2939',
          primaryButtonText: '#FFFFFF',
          secondaryButtonHoverBg: '#1D2939',
          connectedButtonBg: '#101828',
          connectedButtonBgHover: '#1D2939',
          borderColor: '#344054',
        },
      })}
    />
  )
}

export default ConnectButton
