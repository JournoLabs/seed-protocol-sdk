import React, { FC } from "react"
import { ConnectButton as ConnectButtonThirdweb, darkTheme } from "thirdweb/react"
import { client as seedClient } from "@seedprotocol/sdk"
import { getClient, getConnectedManagedAccountAddress, getManagedAccountWallet, getWalletsForConnectButton } from "../helpers/thirdweb"
import { usePublishConfig } from "./PublishProvider"
import { getPublishConfig } from "../config"
import { optimismSepolia } from "thirdweb/chains"
import type { Account, Wallet } from "thirdweb/wallets"
import type { PublishConfig } from "../config"
import { ensureExecutorModuleInstalled } from "../helpers/ensureExecutorModule"

function reportWalletSetupWarning(err: unknown) {
  console.error("[ConnectButton] Wallet setup / module install failed:", err)
  getPublishConfig().onWalletSetupWarning?.(err)
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

  const handleDisconnect = async () => {
    console.log('[ConnectButton] Disconnected')
    try {
      await seedClient.setAddresses([])
    } catch (err) {
      console.warn('[ConnectButton] Failed to clear seed client addresses:', err)
    }
  }

  const handleConnect = async (activeWallet: Wallet, _allConnectedWallets: Wallet[]) => {
    const account = activeWallet.getAccount()
    if (!account) return
    console.log('[ConnectButton] Connected', account.address)
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
