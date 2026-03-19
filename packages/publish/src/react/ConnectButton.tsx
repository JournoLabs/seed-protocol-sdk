import React, { FC } from "react"
import { ConnectButton as ConnectButtonThirdweb, darkTheme } from "thirdweb/react"
import { client as seedClient } from "@seedprotocol/sdk"
import { getClient, getConnectedManagedAccountAddress, getWalletsForConnectButton } from "../helpers/thirdweb"
import { usePublishConfig } from "./PublishProvider"
import { optimismSepolia } from "thirdweb/chains"
import { getContract, sendTransaction, waitForReceipt } from "thirdweb"
import { getInstalledModules, installModule } from "thirdweb/modules"
import type { Account, Wallet } from "thirdweb/wallets"
import { encodeAbiParameters } from "viem"
import { EAS_CONTRACT_ADDRESS } from "../helpers/constants"
import type { PublishConfig } from "../config"

async function ensureModularAccountModule(account: Account, config: PublishConfig): Promise<void> {
  const { modularAccountModuleContract } = config
  if (!modularAccountModuleContract) return

  const accountContract = getContract({
    client: getClient(),
    chain: optimismSepolia,
    address: account.address,
  })

  const installed = await getInstalledModules({ contract: accountContract })
  const moduleAddr = modularAccountModuleContract.toLowerCase()
  const isInstalled = installed.some(
    (m: { implementation: string }) => m.implementation?.toLowerCase() === moduleAddr
  )
  if (isInstalled) return

  const tx = installModule({
    contract: accountContract,
    moduleContract: modularAccountModuleContract,
    data: encodeAbiParameters(
      [{ type: "address" }],
      [EAS_CONTRACT_ADDRESS]
    ),
  })
  const result = await sendTransaction({ transaction: tx, account })
  await waitForReceipt({
    client: getClient(),
    transactionHash: result.transactionHash,
    chain: optimismSepolia,
  })
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
    if (config.useModularExecutor) {
      try {
        const managedAddr = await getConnectedManagedAccountAddress(optimismSepolia)
        if (managedAddr) owned.add(managedAddr.toLowerCase())
      } catch {
        /* managed account may not exist yet */
      }
    }
    try {
      await seedClient.setAddresses({ owned: [...owned] })
    } catch (err) {
      console.warn('[ConnectButton] Failed to set seed client addresses:', err)
    }
    try {
      await ensureModularAccountModule(account, config)
    } catch (err) {
      console.warn('[ConnectButton] Module check/install failed:', err)
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
      // accountAbstraction={{
      //   chain          : optimismSepolia,
      //   factoryAddress : thirdwebAccountFactoryAddress,
      //   gasless        : true,
      //   overrides: {
      //     execute: (accountContract, transaction) => {
      //       // Log the gas that was set on the transaction
      //       console.log("[SmartWallet Execute]", {
      //         gas: transaction.gas,
      //         to: transaction.to,
      //         dataLength: transaction.data?.length,
      //       });
      
      //       // Return the default execute call — don't change behavior,
      //       // just observe what's being passed through
      //       return prepareContractCall({
      //         contract: accountContract,
      //         method: "function execute(address, uint256, bytes)",
      //         params: [
      //           transaction.to ?? "",
      //           transaction.value ?? 0n,
      //           transaction.data ?? "0x",
      //         ],
      //         gas: transaction.gas, // Pass through whatever was set
      //       });
      //     },
      //   },
      // }}
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