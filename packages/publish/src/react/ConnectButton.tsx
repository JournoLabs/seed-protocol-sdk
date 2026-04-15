import React, { FC, useEffect } from "react"
import { ConnectButton as ConnectButtonThirdweb, darkTheme } from "thirdweb/react"
import { client as seedClient } from "@seedprotocol/sdk"
import {
  disconnectAllInAppPublishWallets,
  getClient,
  getConnectedManagedAccountAddress,
  getManagedAccountWallet,
  getWalletsForConnectButton,
  debugLogWalletPersistenceSnapshot,
} from "../helpers/thirdweb"
import { usePublishConfig } from "./PublishProvider"
import { getPublishConfig } from "../config"
import { optimismSepolia } from "thirdweb/chains"
import type { Account, Wallet } from "thirdweb/wallets"
import type { PublishConfig } from "../config"
import { ensureExecutorModuleInstalled } from "../helpers/ensureExecutorModule"
import { PublishManager } from "../services/publishManager"

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

  // #region agent log
  useEffect(() => {
    debugLogWalletPersistenceSnapshot(
      'ConnectButton.tsx:mount',
      'H1',
      'ConnectButton mounted (initial persistence snapshot)',
    )
  }, [])
  // #endregion

  const handleDisconnect = async () => {
    // #region agent log
    debugLogWalletPersistenceSnapshot(
      'ConnectButton.tsx:handleDisconnect:pre',
      'H2',
      'handleDisconnect before stopAll/setAddresses/disconnectAll',
    )
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'af71b7' },
      body: JSON.stringify({
        sessionId: 'af71b7',
        location: 'ConnectButton.tsx:handleDisconnect',
        message: 'onDisconnect fired',
        data: { hypothesisId: 'H2', timestamp: Date.now() },
      }),
    }).catch(() => {})
    // #endregion
    console.log('[ConnectButton] Disconnected')
    PublishManager.stopAll()
    try {
      await waitUntilSeedInitialized()
      await seedClient.setAddresses([])
      await disconnectAllInAppPublishWallets()
    } catch (err) {
      console.warn('[ConnectButton] Failed to clear seed client addresses:', err)
    }
  }

  const handleConnect = async (activeWallet: Wallet, _allConnectedWallets: Wallet[]) => {
    const account = activeWallet.getAccount()
    if (!account) return
    // #region agent log
    debugLogWalletPersistenceSnapshot(
      'ConnectButton.tsx:handleConnect',
      'H4',
      'handleConnect after account resolved',
    )
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'af71b7' },
      body: JSON.stringify({
        sessionId: 'af71b7',
        location: 'ConnectButton.tsx:handleConnect',
        message: 'onConnect',
        data: {
          hypothesisId: 'H4',
          addressSample: account.address.slice(0, 10),
          timestamp: Date.now(),
        },
      }),
    }).catch(() => {})
    // #endregion
    console.log('[ConnectButton] Connected', account.address)
    PublishManager.stopAll()
    await waitUntilSeedInitialized()
    const owned = new Set<string>([account.address.toLowerCase()])
    let managedAddress: string | undefined
    if (config.useModularExecutor) {
      try {
        managedAddress = await getConnectedManagedAccountAddress(optimismSepolia)
        owned.add(managedAddress.toLowerCase())
      } catch {
        /* managed account may not exist yet */
      }
    }
    try {
      await seedClient.setAddresses({ owned: [...owned] })
    } catch (err) {
      console.warn('[ConnectButton] Failed to set seed client addresses:', err)
    }
    await ensureExecutorModulesForConnect(account, managedAddress, config)
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
